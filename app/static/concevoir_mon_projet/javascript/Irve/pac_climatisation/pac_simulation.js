/**
 * Module PAC / climatiseur — simulation annuelle pas à pas.
 * ========================================================
 * Fonctions pures (window.PacSimulation, ou require sous Node). Grille : celle de la courbe IRVE
 * (365 jours, 29 février retiré, heure murale, pas de 10/15/30/60 min), pour que la courbe PAC se
 * combine position par position avec la consommation existante et l'IRVE (phase 2).
 *
 * Modèle thermique du bâtiment (options simplifiée ET détaillée — seules les saisies diffèrent) :
 *  - 5R1C : nœuds air, surfaces et masse ; la masse est intégrée par Crank-Nicolson. Méthode horaire
 *    simple de l'ISO 13790 reprise par l'ISO 52016-1 (référence méthodologique) ; implémentation
 *    libre de référence : RC_BuildingSimulator (ETH Zurich, MIT).
 *  - 1R1C (modele1R1C, conservé pour les tests) : C·dTi/dt = Φ − H·(Ti − Te), résolu exactement sur
 *    chaque pas. Écarté pour la simulation : l'air y monte au rythme de la masse, ce qui surestime la
 *    durée de relance après un réduit.
 * Température régulée : température OPÉRATIVE (ressentie) en 5R1C, comme l'ISO 52016-1 —
 * θ_op = 0,3·θ_air + 0,7·θ_s, pondération cohérente avec le nœud de surface du réseau 5R1C ; en 1R1C
 * l'unique nœud tient lieu des deux. Dans les deux cas cette température est LINÉAIRE en la puissance
 * de chauffage/froid Φ : la puissance qui l'amène exactement à la consigne en fin de pas se déduit de
 * deux essais (Φ = 0 et Φ = 10 W/m²), principe de la méthode horaire de l'ISO 13790.
 *
 * Partage du temps de la PAC : une PAC air-eau produit le chauffage (ou le froid) ET l'ECS avec le
 * même compresseur. La fraction de pas consacrée à l'ECS (f_ecs) est retirée de la puissance
 * disponible pour le chauffage (priorité ECS) ; sans priorité ECS, l'ECS n'utilise que le temps
 * laissé libre par le chauffage.
 *
 * Ballon d'ECS : modèle à un nœud (eau mélangée), pertes = étiquette × (T_ballon − T_ambiance) / 45 K.
 * Hystérésis de relance, plage horaire de production, anti-légionelle hebdomadaire ; la partie au-delà
 * de la température d'eau maximale de la PAC est assurée par la résistance du ballon.
 */
(function (racine) {
    'use strict';

    const M = racine.PacModeleCop || (typeof require !== 'undefined' ? require('./pac_modele_cop.js') : null);

    // ---------------------------------------------------------------------------------------
    // Calendrier de la grille (identique à calcul_irve.js : 29 février retiré)
    // ---------------------------------------------------------------------------------------
    function calendrier(annee) {
        const jours = [];
        for (let d = 0; jours.length < 365; d++) {
            const date = new Date(Date.UTC(annee, 0, 1 + d));
            if (date.getUTCMonth() === 1 && date.getUTCDate() === 29) continue;
            jours.push({ mois: date.getUTCMonth(), jourSemaine: date.getUTCDay(), jour: date.getUTCDate() });
        }
        return jours;
    }

    function dansPlage(h, debut, fin) {
        if (debut === fin) return false;
        return debut < fin ? (h >= debut && h < fin) : (h >= debut || h < fin);
    }

    // ---------------------------------------------------------------------------------------
    // Modèles thermiques
    // ---------------------------------------------------------------------------------------
    function modele1R1C(b, tInit) {
        let ti = tInit;
        const H = Math.max(b.H, 1e-6);
        const C = Math.max(b.C, 1);
        function calculer(te, phi, dt) {
            const teq = te + phi / H;
            return teq + (ti - teq) * Math.exp(-dt * H / C);
        }
        return {
            tAir: () => ti,
            essai: (te, phiInt, phiSol, phiHC, dt) => calculer(te, phiInt + phiSol + phiHC, dt),
            valider(te, phiInt, phiSol, phiHC, dt) { ti = calculer(te, phiInt + phiSol + phiHC, dt); return ti; },
        };
    }

    function modele5R1C(b, tInit) {
        let tm = tInit;
        let tOp = tInit;
        const hVe = Math.max(b.hVe, 1e-3);
        const hTrW = b.hTrW;
        const hTrIs = b.hIs * b.aT;
        const hTrMs = b.hMs * b.aM;
        const den = b.hTrOp > 0 ? 1 / b.hTrOp - 1 / hTrMs : Infinity;
        const hTrEm = !Number.isFinite(den) ? 0 : (den > 1e-9 ? 1 / den : 1e9);
        const hTr1 = 1 / (1 / hVe + 1 / hTrIs);
        const hTr2 = hTr1 + hTrW;
        const hTr3 = 1 / (1 / hTr2 + 1 / hTrMs);
        const fMasse = b.aM / b.aT;
        const fSurface = Math.max(0, 1 - fMasse - hTrW / (b.hMs * b.aT));

        function calculer(te, phiInt, phiSol, phiHC, dt) {
            const tSup = te; // air neuf à la température extérieure (récupération incluse dans hVe)
            const phiIa = 0.5 * phiInt + phiHC;
            const gainsRayonnes = 0.5 * phiInt + phiSol;
            const phiSt = fSurface * gainsRayonnes;
            const phiM = fMasse * gainsRayonnes;
            const phiMTot = phiM + hTrEm * te + hTr3 * (phiSt + hTrW * te + hTr1 * (phiIa / hVe + tSup)) / hTr2;
            const cdt = b.Cm / dt;
            const tmFin = (tm * (cdt - 0.5 * (hTr3 + hTrEm)) + phiMTot) / (cdt + 0.5 * (hTr3 + hTrEm));
            const tmMoy = 0.5 * (tm + tmFin);
            const ts = (hTrMs * tmMoy + phiSt + hTrW * te + hTr1 * (tSup + phiIa / hVe)) / (hTrMs + hTrW + hTr1);
            const tAir = (hTrIs * ts + hVe * tSup + phiIa) / (hTrIs + hVe);
            return { tOp: 0.3 * tAir + 0.7 * ts, tmFin };
        }
        return {
            tAir: () => tOp,
            essai: (te, phiInt, phiSol, phiHC, dt) => calculer(te, phiInt, phiSol, phiHC, dt).tOp,
            valider(te, phiInt, phiSol, phiHC, dt) {
                const r = calculer(te, phiInt, phiSol, phiHC, dt);
                tm = r.tmFin; tOp = r.tOp;
                return tOp;
            },
            reseau: { hVe, hTrW, hTrIs, hTrMs, hTrEm },
        };
    }

    // ---------------------------------------------------------------------------------------
    // Simulation
    // ---------------------------------------------------------------------------------------
    /**
     * e = {
     *   pasMin, annee,
     *   meteo: { temperature[], humidite[], irradiation: {N,E,S,O} },  (grille murale 365 j)
     *   batiment: sortie de PacDimensionnement.batimentSimplifie / batimentDetaille,
     *   apports: { appareilsWm2, occupantSensibleW, facteurEte (rapport protection été / ombrage hiver) },
     *   consignes: { chauffage, reduit, reduitDebut, reduitFin, froid, occupants,
     *                absenceSemaine, absenceDebut, absenceFin, reduitEnAbsence, froidSeulementPresence },
     *   usages: { chauffage, froid, ecs },
     *   systeme: 'air_eau'|'air_air',
     *   chaud: modèle PacModeleCop (ou null), froid: modèle (ou null),
     *   loiDeau: { tBase, departBase, tNonChauffage, departDoux, departMax } | null (air-air),
     *   puitsChaud (air-air, °C), departFroid (°C : eau glacée ou air intérieur),
     *   appoint: { puissanceKw, tBivalence },
     *   ecs: { litresJour, profil[24], tUsage, consigne, hysteresis, volume, pertesKwh24h, tAmbiance,
     *          eauFroideMensuelle[12], resistanceKw, tEauMaxPac, plage: {debut, fin}|null,
     *          antilegionelle: {actif, jourSemaine, heure, temperature}, priorite },
     *   aux: { circulateurW, veilleW, carterW, carterSeuilC, ventilateurW, nbUnitesInterieures,
     *          horsTensionHorsSaison (veille et carter comptés seulement les mois où l'équipement sert) },
     *   ideal: true -> puissances illimitées (besoins du bâtiment, sans consommation électrique)
     * }
     *
     * Confort : une heure est « d'inconfort » quand la température régulée reste à plus de 1 K de la
     * consigne (en dessous en chauffage, au-dessus en froid), hors des RELANCE_H heures qui suivent la
     * fin d'un réduit ou d'une absence (montée en température normale, même avec une puissance
     * suffisante).
     */
    const RELANCE_H = 2;
    const TOLERANCE_CONFORT_K = 1;

    function simuler(e) {
        const pas = e.pasMin;
        const dtS = pas * 60;
        const dtH = pas / 60;
        const parJour = 1440 / pas;
        const n = 365 * parJour;
        const cal = calendrier(e.annee);
        const met = e.meteo;
        const b = e.batiment;
        const cons = e.consignes;
        const us = e.usages;
        const ap = e.apports;
        const ecs = us.ecs ? e.ecs : null;
        const aux = e.aux || {};
        const appoint = e.appoint || { puissanceKw: 0, tBivalence: -99 };
        const ideal = !!e.ideal;

        const tInit = cons.chauffage;
        const bm = b.modele === '5r1c' ? modele5R1C(b, tInit) : modele1R1C(b, tInit);
        const phiTest = 10 * b.surface;

        const sortie = {};
        ['tAir', 'qChauffagePac', 'qChauffageAppoint', 'qFroid',
            'qEcsPac', 'qEcsResistance', 'eChauffage', 'eFroid', 'eEcs', 'eAppoint', 'eAuxiliaires', 'tBallon']
            .forEach((k) => { sortie[k] = new Float64Array(n); });

        // Ballon
        const cBallon = ecs ? ecs.volume * 1.163 : 0; // Wh/K
        const uaBallon = ecs ? ecs.pertesKwh24h * 1000 / 24 / 45 : 0; // W/K
        let tBallon = ecs ? ecs.consigne : 0;
        let enCharge = false;
        let antilegEnCours = false;
        let heuresEcsInconfort = 0;
        let heuresInconfortChaud = 0;
        let heuresInconfortFroid = 0;
        let consignePrecedente = null;
        let relanceRestanteH = 0;

        const auxArret = new Float64Array(n);
        const moisActifs = new Array(12).fill(false);
        const modMinChaud = e.chaud ? e.chaud.modulationMin : 0;
        const modMinFroid = e.froid ? e.froid.modulationMin : 0;

        // Préchauffage : 14 jours de fin d'année simulés avant la grille (état initial réaliste).
        const prechauffe = 14 * parJour;
        for (let k = -prechauffe; k < n; k++) {
            const i = (k + n) % n;
            const enregistrer = k >= 0;
            const te = met.temperature[i];
            const hr = met.humidite ? met.humidite[i] : 80;
            const jour = cal[Math.floor(i / parJour)];
            const minute = (i % parJour) * pas;
            const heure = Math.floor(minute / 60);
            const weekend = jour.jourSemaine === 0 || jour.jourSemaine === 6;
            const absent = !!cons.absenceSemaine && !weekend && dansPlage(heure, cons.absenceDebut, cons.absenceFin);

            const consigneChaud = (dansPlage(heure, cons.reduitDebut, cons.reduitFin) || (absent && cons.reduitEnAbsence))
                ? cons.reduit : cons.chauffage;
            const consigneFroid = (cons.froidSeulementPresence && absent) ? Infinity : cons.froid;
            if (consignePrecedente !== null && consigneChaud > consignePrecedente) relanceRestanteH = RELANCE_H;
            consignePrecedente = consigneChaud;

            const occupants = absent ? 0 : cons.occupants;
            const phiInt = ap.appareilsWm2 * b.surface + occupants * ap.occupantSensibleW;
            // Protections solaires fermées quand il fait chaud à l'intérieur.
            const fSol = bm.tAir() > cons.froid - 1 ? ap.facteurEte : 1;
            const irr = met.irradiation;
            const phiSol = fSol * (b.vitrages.N * irr.N[i] + b.vitrages.E * irr.E[i] + b.vitrages.S * irr.S[i] + b.vitrages.O * irr.O[i]);

            // ---------- ECS (énergie en Wh sur le pas) ----------
            let fEcs = 0; let qEcsPac = 0; let qEcsRes = 0; let eEcs = 0;
            let twEcs = 0; let capEcsW = 0;
            let ecsPrete = null; // fonction qui produit l'ECS avec une fraction de temps disponible
            if (ecs) {
                const tEf = ecs.eauFroideMensuelle[jour.mois];
                const qPuisage = ecs.litresJour * ecs.profil[heure] * (pas / 60) * 1.163 * Math.max(0, ecs.tUsage - tEf);
                const qPertes = uaBallon * (tBallon - ecs.tAmbiance) * dtH;
                const al = ecs.antilegionelle;
                if (al && al.actif && jour.jourSemaine === al.jourSemaine && heure === al.heure && minute % 60 === 0) antilegEnCours = true;
                const plageOk = !ecs.plage || dansPlage(heure, ecs.plage.debut, ecs.plage.fin);
                if ((tBallon < ecs.consigne - ecs.hysteresis && plageOk) || tBallon < ecs.tUsage || antilegEnCours) enCharge = true;
                const cible = antilegEnCours ? Math.max(ecs.consigne, al.temperature) : ecs.consigne;
                const tMaxPac = ecs.tEauMaxPac;
                const pacPossible = !!e.chaud && e.chaud.enPlage(te);
                twEcs = Math.min(tMaxPac + 5, tBallon + 5);
                capEcsW = pacPossible ? e.chaud.capaciteKw(te, twEcs, hr) * 1000 : 0;

                ecsPrete = (fractionDispo) => {
                    let qPac = 0; let qRes = 0;
                    if (enCharge) {
                        const besoin = cBallon * (cible - tBallon) + qPuisage + qPertes;
                        const besoinPac = Math.max(0, cBallon * (Math.min(cible, tMaxPac) - tBallon) + qPuisage + qPertes);
                        qPac = Math.max(0, Math.min(besoinPac, capEcsW * dtH * fractionDispo));
                        // Résistance : au-delà de la température maximale de la PAC, PAC indisponible,
                        // ou ballon sous la température d'usage (confort).
                        const resteur = Math.max(0, besoin - qPac);
                        const resAutorisee = cible > tMaxPac || capEcsW === 0 || tBallon < ecs.tUsage;
                        if (resAutorisee && ecs.resistanceKw > 0) qRes = Math.min(resteur, ecs.resistanceKw * 1000 * dtH);
                    }
                    const f = capEcsW > 0 ? qPac / (capEcsW * dtH) : 0;
                    return { qPac, qRes, f, qPuisage, qPertes };
                };
            }

            // ---------- Chauffage / froid ----------
            const appliquerEcs = (r) => {
                qEcsPac = r.qPac; qEcsRes = r.qRes; fEcs = r.f;
                eEcs = qEcsPac > 0 ? qEcsPac / e.chaud.rendement(te, twEcs, hr, 1) : 0;
                tBallon += (qEcsPac + qEcsRes - r.qPuisage - r.qPertes) / cBallon;
                // Ballon vidé : il ne descend pas sous l'eau froide (le puisage manquant n'est pas servi).
                tBallon = Math.max(tBallon, ecs.eauFroideMensuelle[jour.mois]);
                if (tBallon < ecs.tUsage) heuresEcsInconfort += enregistrer ? dtH : 0;
                const cibleAtteinte = tBallon >= (antilegEnCours ? Math.max(ecs.consigne, ecs.antilegionelle.temperature) : ecs.consigne) - 1e-6;
                if (cibleAtteinte) { enCharge = false; antilegEnCours = false; }
            };
            const prioriteEcs = ecs ? ecs.priorite !== false : false;
            if (ecs && prioriteEcs) appliquerEcs(ecsPrete(1));

            const t0 = bm.essai(te, phiInt, phiSol, 0, dtS);
            let phi = 0; let qPac = 0; let qApp = 0; let qFroid = 0;
            let eChauffage = 0; let eFroid = 0; let espaceActif = false; let tauxMarche = 0;

            if (us.chauffage && t0 < consigneChaud) {
                espaceActif = true;
                const t10 = bm.essai(te, phiInt, phiSol, phiTest, dtS);
                const besoin = Math.max(0, phiTest * (consigneChaud - t0) / (t10 - t0));
                if (ideal) {
                    qPac = besoin;
                } else {
                    const tw = e.systeme === 'air_eau' ? M.loiDeau(te, e.loiDeau) : e.puitsChaud;
                    const capW = e.chaud ? e.chaud.capaciteKw(te, tw, hr) * 1000 : 0;
                    const capDispo = capW * Math.max(0, 1 - fEcs);
                    qPac = Math.min(besoin, capDispo);
                    const appointOk = appoint.puissanceKw > 0 && (te <= appoint.tBivalence || capW === 0);
                    qApp = appointOk ? Math.min(besoin - qPac, appoint.puissanceKw * 1000) : 0;
                    const plr = capDispo > 0 ? qPac / capDispo : 0;
                    if (qPac > 0) {
                        eChauffage = qPac / e.chaud.rendement(te, tw, hr, plr) * dtH;
                        tauxMarche = (plr >= modMinChaud ? 1 : plr / modMinChaud) * (1 - fEcs);
                    }
                }
                phi = qPac + qApp;
            } else if (us.froid && t0 > consigneFroid) {
                espaceActif = true;
                const t10 = bm.essai(te, phiInt, phiSol, -phiTest, dtS);
                const besoin = Math.max(0, phiTest * (t0 - consigneFroid) / (t0 - t10));
                if (ideal) {
                    qFroid = besoin;
                } else {
                    const tw = e.departFroid;
                    const capW = e.froid ? e.froid.capaciteKw(te, tw, hr) * 1000 : 0;
                    const capDispo = capW * Math.max(0, 1 - fEcs);
                    qFroid = Math.min(besoin, capDispo);
                    const plr = capDispo > 0 ? qFroid / capDispo : 0;
                    if (qFroid > 0) {
                        eFroid = qFroid / e.froid.rendement(te, tw, hr, plr) * dtH;
                        tauxMarche = (plr >= modMinFroid ? 1 : plr / modMinFroid) * (1 - fEcs);
                    }
                }
                phi = -qFroid;
            }

            if (ecs && !prioriteEcs) appliquerEcs(ecsPrete(Math.max(0, 1 - tauxMarche)));

            const tFin = bm.valider(te, phiInt, phiSol, phi, dtS);
            if (enregistrer) {
                if (us.chauffage && relanceRestanteH <= 0 && tFin < consigneChaud - TOLERANCE_CONFORT_K) heuresInconfortChaud += dtH;
                if (us.froid && Number.isFinite(consigneFroid) && tFin > consigneFroid + TOLERANCE_CONFORT_K) heuresInconfortFroid += dtH;
            }
            relanceRestanteH -= dtH;

            // ---------- Auxiliaires (W) : en marche / à l'arrêt (veille, carter) ----------
            let pAuxMarche = 0; let pAuxArret = 0;
            if (!ideal) {
                const marche = Math.min(1, fEcs + tauxMarche);
                if (e.systeme === 'air_eau') pAuxMarche += (aux.circulateurW || 0) * (espaceActif ? 1 : fEcs);
                else pAuxMarche += (aux.ventilateurW || 0) * (aux.nbUnitesInterieures || 1) * (espaceActif ? 1 : 0);
                if (te < (aux.carterSeuilC ?? 10)) pAuxArret += (aux.carterW || 0) * (1 - marche);
                pAuxArret += (aux.veilleW || 0) * (1 - marche);
            }

            if (enregistrer) {
                // Puissances moyennes sur le pas, en kW.
                const kW = (wh) => wh / dtH / 1000;
                sortie.tAir[i] = bm.tAir();
                sortie.qChauffagePac[i] = qPac / 1000;
                sortie.qChauffageAppoint[i] = qApp / 1000;
                sortie.qFroid[i] = qFroid / 1000;
                sortie.qEcsPac[i] = kW(qEcsPac);
                sortie.qEcsResistance[i] = kW(qEcsRes);
                sortie.eChauffage[i] = kW(eChauffage);
                sortie.eFroid[i] = kW(eFroid);
                sortie.eEcs[i] = kW(eEcs);
                sortie.eAppoint[i] = qApp / 1000 + kW(qEcsRes);
                sortie.eAuxiliaires[i] = pAuxMarche / 1000;
                auxArret[i] = pAuxArret / 1000;
                if (qPac > 0 || qApp > 0 || qFroid > 0 || qEcsPac > 0 || qEcsRes > 0) moisActifs[jour.mois] = true;
                sortie.tBallon[i] = tBallon;
            }
        }
        // Veille et carter : seulement les mois où l'équipement a servi, s'il est mis hors tension
        // le reste de l'année.
        for (let i = 0; i < n; i++) {
            if (!aux.horsTensionHorsSaison || moisActifs[cal[Math.floor(i / parJour)].mois]) sortie.eAuxiliaires[i] += auxArret[i];
        }
        sortie.heuresEcsInconfort = heuresEcsInconfort;
        sortie.heuresInconfortChaud = heuresInconfortChaud;
        sortie.heuresInconfortFroid = heuresInconfortFroid;
        sortie.pasMin = pas;
        sortie.annee = e.annee;
        return sortie;
    }

    /** Agrégats : totaux annuels et mensuels (kWh), pointes, SCOP simulé, couverture. */
    function synthese(s) {
        const pas = s.pasMin;
        const dtH = pas / 60;
        const parJour = 1440 / pas;
        const cal = calendrier(s.annee);
        const usages = ['eChauffage', 'eFroid', 'eEcs', 'eAppoint', 'eAuxiliaires'];
        const mensuel = {}; const annuel = {};
        usages.concat(['qChauffagePac', 'qChauffageAppoint', 'qFroid', 'qEcsPac', 'qEcsResistance'])
            .forEach((k) => { mensuel[k] = new Array(12).fill(0); annuel[k] = 0; });
        const total = new Float64Array(s.eChauffage.length);
        let pointe = 0;
        for (let i = 0; i < total.length; i++) {
            const m = cal[Math.floor(i / parJour)].mois;
            Object.keys(mensuel).forEach((k) => { const v = s[k][i] * dtH; mensuel[k][m] += v; annuel[k] += v; });
            total[i] = usages.reduce((acc, k) => acc + s[k][i], 0);
            if (total[i] > pointe) pointe = total[i];
        }
        const eTotal = usages.reduce((acc, k) => acc + annuel[k], 0);
        const chaleurPac = annuel.qChauffagePac + annuel.qEcsPac;
        const chaleurTotale = chaleurPac + annuel.qChauffageAppoint + annuel.qEcsResistance;
        return {
            mensuel, annuel, total, eTotal, pointeKw: pointe,
            scopChauffage: annuel.eChauffage > 0 ? annuel.qChauffagePac / annuel.eChauffage : null,
            seerSimule: annuel.eFroid > 0 ? annuel.qFroid / annuel.eFroid : null,
            // Performance du système complet (appoint et auxiliaires compris) pour la chaleur.
            performanceGlobaleChaud: (annuel.eChauffage + annuel.eEcs + annuel.eAppoint) > 0
                ? chaleurTotale / (annuel.eChauffage + annuel.eEcs + annuel.eAppoint + annuel.eAuxiliaires) : null,
            couverturePac: chaleurTotale > 0 ? chaleurPac / chaleurTotale : null,
            heuresInconfortChaud: s.heuresInconfortChaud,
            heuresInconfortFroid: s.heuresInconfortFroid,
            heuresEcsInconfort: s.heuresEcsInconfort,
        };
    }

    const api = { calendrier, dansPlage, modele1R1C, modele5R1C, simuler, synthese };
    racine.PacSimulation = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
