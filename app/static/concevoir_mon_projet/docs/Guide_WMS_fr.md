# GUIDE D’UTILISATION DU SERVICE WMS

## 1. Son intérêt

La directive européenne 2007/2/CE du 14 mars 2007, dite directive « Inspire » vise à établir une infrastructure d’information
géographique dans la Communauté européenne pour favoriser la protection de l’environnement. Par « infrastructure d’information
géographique », il convient d’entendre un ensemble de services d’information disponibles sur Internet, répartis sur les sites web des
différents acteurs concernés, et permettant la diffusion et le partage de données géographiques, c’est-à-dire de cartes interactives
et de données associées.
Dans ce cadre notamment, la Direction générale des Finances publiques (DGFiP) propose un service «WMS » de consultation du
plan cadastral.
L’utilisateur voudra bien se référer aux conditions générales d’utilisation de ce service en ligne sur le site cadastre.gouv.fr.

## 1.1 Les données concernées

Le service WMS est proposé sur le site cadastre.gouv.fr pour chacune des communes dont le plan cadastral est géré au format
vecteur. Ce service n’est pas accessible aux communes dont les plans cadastraux sont gérés au format image.
Le détail des données peut être consulté dans le descriptif technique du service « WMS » du présent document _(cf. chapitre 1.2)_

## 1.2 Les emprises géographiques, formats et projections

Le service WMS est disponible sur l'ensemble du territoire national (France métropolitaine et DOM), dans la limite des restrictions
visées au paragraphe 1.1.1.
Les données sont accessibles en WMS dans les projections suivantes.
 projections coniques conformes 9 zones ;
 en Lambert 93 ;
 en WGS84 ;
 en mercator (pour la compatibilité avec GoogleMaps).
 en ETRS 89 (système européen préconisé par INSPIRE pour les données cadastrales)
Les projections sont définies par leur code projection EPSG.
Le détail des données, des emprises et formats peut être consulté dans le descriptif technique du service de consultation INSPIRE.

## 1.3 Les modalités d'accès

Le service « WMS » est accessible gratuitement.
Les plans cadastraux sont consultables de plusieurs façons :
 directement depuis le site cadastre.gouv.fr ;
 par l'intermédiaire d'un site internet ou d'un système d’information géographique (SIG) doté des composants permettant
d'accéder au service WMS du site cadastre.gouv.fr

#### 1.3.1 Les différentes utilisations du service WMS (standard et premium)

Deux types d’utilisation sont proposées :
 une utilisation « standard » c’est à dire sans nécessité d’avoir créé au préalable un compte client sur le site
cadastre.gouv.fr ;
 une utilisation « premium » nécessitant de disposer au préalable d’un compte client sur le site cadastre.gouv.fr et
d’accepter les conditions d’utilisation du service WMS. Cette option permet en contrepartie de disposer de droits élargis


```
par rapport au mode « standard » et d’une plus grande capacité de services compatibles avec les exigences de
performance et de disponibilité prévues par la réglementation technique de la directive INSPIRE.
```
#### 1.3.2 La demande d’accès au service WMS « premium »

Pour bénéficier du mode « premium », vous devez en faire la demande au travers de votre compte client sur le site cadastre.gouv.fr,
menu « Votre service WMS ».
Pour des raisons techniques, la DGFiP se réserve le droit de refuser cette demande.
En cas d’acceptation, vous devez accepter les conditions d’utilisations du service WMS.
Vous obtenez une clé WMS que vous devez renseigner dans chaque requête WMS.
Vous avez également la possibilité de saisir une adresse IP pour protéger l’utilisation de votre service WMS.

#### 1.3.3 L’accès WMS

Vous pouvez accéder au service WMS en mode « standard » dans votre navigateur, une application WEB ou un SIG en renseignant
les URL (adresses WEB) suivantes :
https ://inspire.cadastre.gouv.fr/scpc/[codeINSEE].wms?service=WMS&request=GetCapabilities
https ://inspire.cadastre.gouv.fr/scpc/[codeINSEE].wms?service=WMS&request=GetMap
https://inspire.cadastre.gouv.fr/scpc/[codeINSEE].wms?service=WMS&request=Get FeatureInfo

Vous pouvez également accéder au service WMS en mode « premium » dans votre navigateur, une application WEB ou un SIG en
renseignant les URL (adresses WEB) suivantes :
https ://inspire.cadastre.gouv.fr/scpc/[cleWMS]/[codeINSEE].wms? service=WMS&request=GetCapabilities
https ://inspire.cadastre.gouv.fr/scpc/[cleWMS]/[codeINSEE].wms?service=WMS&request=GetMap
https://inspire.cadastre.gouv.fr/scpc/[cleWMS]/[codeINSEE].wms?service=WMS&request=Get FeatureInfo

L’accès WMS s’effectue à la commune pour les communes dont le plan cadastral est géré au format vecteur
La [cléWMS] nécessaire en mode « premium » est générée automatiquement à l’activation du service WMS.
Le [CodeINSEE] doit être remplacé par le code INSEE de la commune sur laquelle la consultation est souhaitée.

### 1.4 Les statistiques

Vous avez la possibilité d’obtenir les statistiques d’utilisation de votre service WMS sur une période configurable.

## 2 Description technique du service WMS

### 2.1 Qu’est-ce qu’un web service?

Un service en réseau ou « web service » est un programme informatique permettant la communication et l’échange de données
entre applications et systèmes hétérogènes dans des environnements distribués. Il s’agit donc d’un ensemble de fonctionnalités
exposées sur Internet ou sur un Intranet, par et pour des applications ou machines, sans intervention humaine, et en temps réel.
En géomatique un web service propose un service qui va permettre la prise en charge distante de données, soit pour la
consultation, c’est-à-dire l’affichage simple de carte (WMS, WMTS), soit pour du stockage de données (WCS et WFS) soit pour du
traitement distant pour éviter d’utiliser du temps d’utilisation du processeur et de la mémoire.
Le site cadastre.gouv.fr est une infrastructure hébergeant des services web de données géographiques. Ces services permettent
notamment la visualisation et le téléchargement des données géographiques via des requêtes adaptées.
Les services web peuvent délivrer des données raster ou vecteur. Le fonctionnement des services web a été standardisé pour
chaque type de données : protocoles WMS (Web Map Service) ou WMTS (Web Map Tiled Service) pour les données raster,
protocole WFS (Web Feature Service) pour les données vecteur ou protocole OpenLS pour le géocodage. Les standards décrivent


les paramètres à renseigner pour pouvoir accéder correctement au résultat recherché : identification des couches ou des objets,
emprise, projection utilisée, etc.
Seul le service WMS est implémenté aujourd’hui sur le site cadastre.gouv.fr.

### 2.2 Qu’est-ce le protocole WMS?

#### 2.2.1 Fonctionnement

Les services WMS permettent de mettre à disposition d’utilisateurs distants des données raster géoréférencées via une simple
requête HTTP. Les données sont restituées sous forme d’images, avec différents formats possibles (JPEG, PNG, GIF). Il est
possible d’afficher dans un même client web des données provenant de différents services WMS, et donc de créer des cartes
combinées en jouant sur la transparence des couches.
WMS est un standard de l’OGC (Open Geospatial Consortium).
L’application cliente interroge le serveur à l’aide de requêtes dont les valeurs et les paramètres sont précisés dans l’adresse URL
(adresse WEB).

#### 2.2.2 Requêtes possibles

Les requêtes qui sont adressées au serveur WMS sont les suivantes :
 GetCapabilities renvoie les paramètres du service et les couches disponibles
 GetMap : renvoie une image de la carte
 GetFeatureInfo : renvoie des informations sur les objets de la carte

#### 2.2.3 Adresse URL

La requête apparaît dans l’URL (adresse WEB) qui est envoyée au serveur de données.
Une adresse URL (adresse WEB) revêt la syntaxe suivante : https://nom_serveur/chemin_d_acces?{nom=valeur&}
? sépare l’adresse du serveur des paramètres.
= attribue une valeur à un paramètre.
& sépare les différents paramètres dans l’adresse.

#### 2.2.4 Paramètres disponibles

Les paramètres qui peuvent être utilisés dépendent de la requête soumise (GetCapabilities, GetMap,GetFeatureInfo).
Ils peuvent être communs ou spécifiques, obligatoires ou optionnels. Les principaux paramètres utilisés sont les suivants (liste non
exhaustive) :

#### 2.2.5 Paramètres communs

```
 VERSION : la version du service utilisée est 1.
 REQUEST : la requête adressée au serveur (GetCapabilities, GetMap, GetFeatureInfo)
```
#### 2.2.6 Paramètres spécifiques GetCapabilities

```
 SERVICE : le type de service (WMS)
 LANGUAGE : le langage
```
#### 2.2.7 Paramètres spécifiques GetMap

```
 FORMAT : le format de sortie du fichier image (PNG, JPEG, GIF)
 LAYERS : liste des couches
```

```
 STYLES : le style de rendu des couches
 WIDTH : largeur de l’image en pixels
 HEIGHT : hauteur de l’image en pixels
 CRS : système de coordonnées utilisé
 BBOX (Bounding Box) : l’emprise de la carte
```
#### 2.2.8 Paramètres spécifiques GetFeatureInfo

- FORMAT : le format de sortie du fichier image (PNG, JPEG, GIF)
- LAYERS : liste des couches
- STYLES : le style de rendu des couches
- WIDTH : largeur de l’image en pixels
- HEIGHT : hauteur de l’image en pixels
- CRS : système de coordonnées utilisé
- BBOX (Bounding Box) : l’emprise de la carte
- QUERY_LAYERS: la couche à interroger
- INFO_FORMAT : le format de sortie des informations associées aux objets géographiques
- I : abscisse en pixel du point de l'image interrogé
- J : ordonnée en pixel du point de l'image interrogé

#### 2.2.9 LANGUAGE : Les langages

Les langages « fre » (français) « eng » (anglais) et « spa » (espagnol) sont autorisés.

#### 2.2.10 FORMAT : Les formats de l’image

L’utilisateur doit spécifier le format attendu dans le service WMS GetMap.
Format = image/png
Format = image/jpeg
Format = image/gif

#### 2.2.11 LAYERS / STYLES : Les layers et styles utilisés

La liste des layers autorisées est donnée dans le tableau suivant :

```
Name Title / Abstract Keyword Légende Style
AMORCES_CAD Amorces cadastrales
Indique les amorces
cadastrales.
```
```
Limite
Etat
```
```
DEFAUT
```
```
Département DEFAUT
```
```
Commune DEFAUT
```
```
Section cadastrale DEFAUT
```
```
Subdivision de section
Feuille cadastrale
```
##### DEFAUT

```
LIEUDIT Lieu-dit
Indique les limites du lieu-dit
```
```
Limite
Lieu-dit
```
```
DEFAUT
```

```
Name Title / Abstract Keyword Légende Style
```
**CP.CadastralParcel**

```
Parcelle
Indique les limites de la
parcelle
```
```
Limite
Parcelle
```
```
DEFAUT
```
```
Parcelle
Indique les limites de la
parcelle
```
```
Limite
Parcelle
```
```
CP.CadastralParcel.Default
```
```
Autres symboles Autres symboles
non cadastré
```
```
DEFAUT
```
```
SUBFISCAL Subdivision fiscale
Indique les limites de la
subdivision fiscale
```
```
Limite
Subdivision fiscale
```
```
DEFAUT
```
```
Charges de parcelle Charge parcelle DEFAUT
```
```
CLOTURE Clôture
Indique les emprises des
clôtures comme par exemple
des murs, fossés ou clôtures.
```
```
Clôture
Mur mitoyen
```
```
DEFAUT
```
```
Mur non mitoyen DEFAUT
Fossé mitoyen DEFAUT
Fossé non mitoyen DEFAUT
Clôture mitoyenne DEFAUT
Clôture non mitoyenne DEFAUT
Haie mitoyenne DEFAUT
Haie non mitoyenne DEFAUT
DETAIL_TOPO Détails topographiques
Indique les éléments détaillés
comme des ruisseaux,
trottoirs, terrains de sports,
parkings, terrasses, pylônes,
cimetières, et autres
symboles etc.
```
```
Détail topographique
Limite ne formant pas
parcelle
```
```
DEFAUT
```
```
Terrain de sports
Petit ruisseau
Trottoir
```
```
DEFAUT
```
```
Parking
Terrasse
```
```
DEFAUT
```
```
Pylône DEFAUT
Cimetière chrétien DEFAUT
```
```
Cimetière musulman DEFAUT
```

```
Name Title / Abstract Keyword Légende Style
Cimetière israélite DEFAUT
```
```
Halte DEFAUT
```
```
Arrêt DEFAUT
```
```
Station DEFAUT
HYDRO Eléments hydrographiques
Indique les éléments
hydrographiques comme des
puits, étangs, lacs, cours
d’eau, piscines.
```
```
Hydrographie
Puits
```
```
DEFAUT
```
```
Etang
Lac
Cours d’eau
```
##### (*)

```
(*) Représentation Identique pour
les 3 éléments
```
```
DEFAUT
```
Piscine DEFAUT
**VOIE_COMMUNICATION** Petites voies de
communication
Indique les petites voies de
communication comme des
chemins, chaussées, sentiers
ou des réseaux de transports
comme les chemins de fer,
gazoduc, oléoduc, aqueduc,
téléphérique, ligne de
transport de force, ponts,
tunnels et axes de voie.

```
Voies de communication
Chemin
```
```
DEFAUT
```
```
Chemin ne formant pas
parcelle mitoyen
```
```
DEFAUT
```
```
Chemin ne formant pas
parcelle non mitoyen
```
```
DEFAUT
```
```
Limite de chaussée
avec trottoirs
```
```
DEFAUT
```
```
Sentier DEFAUT
Réseaux de transport
Chemin de fer à une
voie
```
```
DEFAUT
```
```
Gazoduc
Oléoduc
```
```
DEFAUT
```
```
Aqueduc DEFAUT
Téléphérique DEFAUT
Ligne de transport de
force
```
```
DEFAUT
```
```
Pont DEFAUT
Tunnel
```
```
Trait représentant le contour
fermé du tunnel
```
```
DEFAUT
```
```
Axe de voie Trait transparent DEFAUT
Numéro
voie
```
##### 9 DEFAUT

```
BU.Building Constructions non
religieuses
Indique les constructions de
type bâtiment en dur
```
```
Bâtiment dur
Maison
```
```
DEFAUT
```
```
Bâtiment léger
hangar
```
```
DEFAUT
```

```
Name Title / Abstract Keyword Légende Style
(maison), bâtiment léger
(hangar), bâtiment en ruine,
église, mosquée ou
synagogue etc.
```
```
Bâtiments dur ou léger BU.Building.Default
```
```
Bâtiment en ruine DEFAUT
```
```
Ensemble immobiliers Aucune représentation spécifique
hormis le point d’implantation du
libellé. :
```
```
DEFAUT
```
```
Eglise DEFAUT
```
```
Mosquée DEFAUT
```
```
Synagogue DEFAUT
```
**BORNE_REPERE** Bornes et repères
Indique les bornes et repères
du type points géodésiques,
points de canevas et points
de polygonation, N.G.F
repères de nivellement,
bornes limites de communes
et bornes de propriété.

```
Bornes et repères
Point géodésique borné
```
```
DEFAUT
Jusqu’à 1/
```
```
Point géodésique non
borné
```
```
DEFAUT
Jusqu’à 1/
```
```
Point de canevas
d’ensemble borné
```
```
DEFAUT
Jusqu’à 1/
```
```
Point de canevas
d’ensemble non borné
```
```
DEFAUT
Jusqu’à 1/
```
```
Point de polygonation
repéré
```
```
DEFAUT
Jusqu’à 1/
Repère N.G.F DEFAUT
Jusqu’à 1/
```
```
Borne du N.G.F. DEFAUT
Jusqu’à 1/
```
```
Nivellement M.R.L. DEFAUT
Jusqu’à 1/
```
```
Autre repère de
Nivellement
```
```
DEFAUT
Jusqu’à 1/
```
```
Borne limite de
Commune
```
```
DEFAUT
Jusqu’à 1/
```
```
Croix gravée DEFAUT
Jusqu’à 1/
Boulon scellé DEFAUT
Jusqu’à 1/
Borne de propriété DEFAUT
Jusqu’à 1/
Calvaire DEFAUT
Jusqu’à 1/
```

#### 2.2.12 WIDTH / HEIGHT : Les largeurs / hauteurs de l’image

```
L’utilisateur doit spécifier la largeur / hauteur de l’image dans le service WMS GetMap.
Les images ne seront pas rendues si elles ne respectent pas cette taille mais un code d’erreur http Bad Request (400) est renvoyé.
La taille sera au minimum de 100x100 et au maximum 1280x1024.
```
#### 2.2.13 CRS : le système de coordonnées utilisé

**Territoire Système
géodésique**

```
Ellipsoïde Projection Code EPSG
```
France RGF93 IAG GRS 1980 Reseau_Geodesique_Francais_
France - onshore and offshore, mainland and
Corsica

##### 2154

France
métropole

```
RGF93 IAG GRS 1980 Lambert 93 Zone 1 (France Métropolitaine - de
40.5° à 43.5° Nord)
```
```
3942 (natif)
```
```
RGF93 IAG GRS 1980 Lambert 93 Zone 2 (France Métropolitaine - de
41.5° à 44.5° Nord)
```
```
3943 (natif)
```
```
RGF93 IAG GRS 1980 Lambert 93 Zone 3 (France Métropolitaine - de
42.5° à 45.5° Nord)
```
```
3944 (natif)
```
```
RGF93 IAG GRS 1980 Lambert 93 Zone 4 (France Métropolitaine - de
43.5° à 46.5° Nord)
```
```
3945 (natif)
```
```
RGF93 IAG GRS 1980 Lambert 93 Zone 5 (France Métropolitaine - de
44.5° à 47.5° Nord)
```
```
3946 (natif)
```
```
RGF93 IAG GRS 1980 Lambert 93 Zone 6 (France Métropolitaine - de
45.5° à 48.5° Nord)
```
```
3947 (natif)
```
```
RGF93 IAG GRS 1980 Lambert 93 Zone 7 (France Métropolitaine - de
46.5° à 49.5° Nord)
```
```
3948 (natif)
```
```
RGF93 IAG GRS 1980 Lambert 93 Zone 8 (France Métropolitaine - de
47.5° à 50.5° Nord)
```
```
3949 (natif)
```
```
RGF93 IAG GRS 1980 Lambert 93 Zone 9 (France Métropolitaine au nord
de 49.5° Nord)
```
```
3950 (natif)
```
France WGS84 IAG GRS 1980 UTM 30N
[http://spatialreference.org/ref/epsg/32630/](http://spatialreference.org/ref/epsg/32630/) Système
UTM, utilisé notamment par les militaires; la zone 30
pour les longitudes entre 0 et 6 degrés ouest

##### 32630

France WGS84 IAG GRS 1980 UTM 31N
Système UTM, utilisé notamment par les militaires;
la zone 31 pour les longitudes entre 0 et 6 degrés
est

##### 32631

France WGS84 IAG GRS 1980 UTM 32N
[http://spatialreference.org/ref/epsg/32630/](http://spatialreference.org/ref/epsg/32630/) Système
UTM, utilisé notamment par les militaires; la zone 32
pour les longitudes entre 6 et 12 degrés est

##### 32632

France Word Mercator
(WGS84)

##### IAG GRS 1980

```
GoogelMaps ...
```
##### 3857

France WGS84 World Geodetic
System 1984

```
Système mondial très utilisé notamment avec le
GPS
```
##### 4326

France ETRS89 Europe Système utilisé en Europe Continentale. 4258
Guadeloupe WGS84 IAG GRS 1980 UTM 20N 32620
Saint-Anne Hayford 1909 UTM 20N **2970 (natif)**
Martinique WGS84 IAG GRS 1980 UTM 20N 32620


**Territoire Système
géodésique**

```
Ellipsoïde Projection Code EPSG
```
Fort Desaix Hayford 1909 UTM 20N **2973 (natif)**
Guyane WGS84 IAG GRS 1980 UTM 22N 32622
RGFG95 IAG GRS 1980 UTM 22N **2972 (natif)**
Réunion WGS84 IAG GRS 1980 UTM 40S 32740
RGR92 IAG GRS 1980 UTM 40S **2975 (natif)**
Mayotte WGS84 IAG GRS 1980 UTM 38S 32738
RGM04 IAG GRS 1980 UTM 38S **4471 (natif)**
St-Pierre et
Miquelon

##### RGSPM

##### (ITRF2000)

##### IAG GRS 1980 UTM 21N 32621

#### 2.2.14 BBOX : Le rectangle de délimitation

```
L’utilisateur doit spécifier le rectangle de délimitation ou la « bounding box » dans la projection pour laquelle il souhaite une
représentation dans le service WMS GetMap.
```
#### 2.2.15 QUERY_LAYERS : Le rectangle de délimitation

```
L’utilisateur doit spécifier la couche pour laquelle il souhaite obtenir les informations associées aux objets géographiques.
Seules les couches intitulées CP.CadastralParcel et BU.Building sont interrogeables.
```
#### 2.2.16 INFO_FORMAT : le format de restitution des informations associées aux objets

#### géographiques

```
L’utilisateur doit spécifier le format dans lequel seront restituées les informations associées aux objets géographiques.
Les deux formats suivants sont proposés:
```
- text/html
- application/vnd.ogc.gml

#### 2.2.17 I : abscisse en pixel du point de l'image interrogé

```
L’utilisateur doit spécifier l’abscisse en pixel du point de l'image qu’il souhaite interroger.
```
#### 2.2.18 J : ordonnée en pixel du point de l'image interrogé

```
L’utilisateur doit spécifier l’ordonnée en pixel du point de l'image qu’il souhaite interroger.
```
#### 2..3 Quelques exemples d’adresses URL

```
Utilisateur « standard »
 url de base sans clé
http s ://inspire.cadastre.gouv.fr/scpc/[codeINSEE].wms?service=WMS&request=GetCapabilities
http s ://inspire.cadastre.gouv.fr/scpc/[codeINSEE].wms?service=WMS&request=GetMap
https://inspire.cadastre.gouv.fr/scpc/[codeINSEE].wms?service=WMS&request=Get FeatureInfo
Le [CodeINSEE] doit être remplacée par le code INSEE de la commune.
Utilisateur « premium »
 url de base avec clé
http s ://inspire.cadastre.gouv.fr/scpc/[cléUtilisateur]/[codeINSEE].wms?service=WMS&request=GetCapabilities
http s ://inspire.cadastre.gouv.fr/scpc/[cléUtilisateur]/[codeINSEE].wms?service=WMS&request=GetMap
https://inspire.cadastre.gouv.fr/scpc/[cléUtilisateur]/[codeINSEE].wms?service=WMS&request=Get FeatureInfo
La [cléUtilisateur] doit être remplacée par la clé unique fournie à l’utilisateur Premium.
Le [CodeINSEE] doit être remplacé par le code INSEE de la commune.
 Modèle d’un GetMap complet
```

```
http s ://inspire.cadastre.gouv.fr/scpc/ [cléUtilisateur]/[codeINSEE].wms?
service=WMS&request=GetMap&VERSION=1.3&CRS=[CRS]&BBOX=[BBOX]&WIDTH=[WIDTH]&HEIGHT=[HEIGHT]&LAYER
S=[LAYERS]&STYLES=&FORMAT=[FORMAT]
La [cléUtilisateur] doit être remplacée par la clé unique fournie à l’utilisateur Premium.
Le [CodeINSEE] doit être remplacé par le code INSEE de la commune.
Le [CRS] doit être remplacé par le code EPSG de l’un des systèmes de coordonnées disponibles et définis dans le
GetCapabilities
Le [BBOX] (Bounding Box) doit être remplacé par l’emprise de la carte
Le [WIDTH] doit être remplacé par la largeur de l’image en pixels
Le [HEIGHT] doit être remplacé par la hauteur de l’image en pixels
Le [LAYERS] doit être remplacé par la liste des layers récupérés du GetCapabilities.
Le [FORMAT] doit être remplacé par le format de sortie du fichier image (PNG, JPEG, GIF)
```
 _Exemple d’url complèteGetMap_
https://inspire.cadastre.gouv.fr/scpc/7d031f212b97467aac/15014.wms?service=wms&version=1.3&request=GetMap&layers=
AMORCES_CAD ,LIEUDIT,CP.CadastralParcel,SUBFISCAL,CLOTURE,DETAIL_TOPO,HYDRO,VOIE_COMMUNICATION,BU.
Building,BORNE_REPERE&format=image/png&crs=EPSG:3945&bbox=1646753.1324380166,4187923.8388985507,1665103.
667975208,4196356.24&width=1000&height=650&styles
 _Modèle d’un GetFeatureInfo complet_
https://inspire.cadastre.gouv.fr/scpc/ [cléUtilisateur]/[codeINSEE].wms?
service=WMS&request=Get FeatureInfo &VERSION=1.3&CRS=[CRS]&BBOX=[BBOX]&WIDTH=[WIDTH]&HEIGHT=[HEIGHT]&
LAYERS=[LAYERS]&STYLES=&FORMAT=[FORMAT] &QUERY_LAYERS=[LAYERS]&INFO_FORMAT=[FORMAT]&I=[I]&J=[J]

```
La [cléUtilisateur] doit être remplacée par la clé unique fournie à l’utilisateur Premium.
Le [CodeINSEE] doit être remplacé par le code INSEE de la commune.
Le [CRS] doit être remplacé par le code EPSG de l’un des systèmes de coordonnées disponibles et définis dans le
GetCapabilities
Le [BBOX] (Bounding Box) doit être remplacé par l’emprise de la carte
Le [WIDTH] doit être remplacé par la largeur de l’image en pixels
Le [HEIGHT] doit être remplacé par la hauteur de l’image en pixels
Le [LAYERS] doit être remplacé par la liste des layers récupérés du GetCapabilities.
Le [FORMAT] doit être remplacé par le format de sortie du fichier image (PNG, JPEG, GIF).
Le [QUERY_LAYERS] doit être remplacé par l'une des couches interrogeables ( CP.CadastralParcel ou BU.Building).
le [INFO_FORMAT] doit être remplacé par le format de restitution des informations associées aux objets géographiques.
le [I] doit être remplacé par l'abscisse en pixel du point de l'image à interroger.
le [J] doit être remplacé par l'ordonnée en pixel du point de l'image à interroger.
```
 _Exemple d’url complète GetFeatureInfo_
https://inspire.cadastre.gouv.fr/scpc/7d031f212b97467aac/15014.wms?
service=wms&version=1.3&request=Get FeatureInfo &layers= AMORCES_CAD ,LIEUDIT,CP.CadastralParcel,SUBFISCAL,CLOT
URE,DETAIL_TOPO,HYDRO,VOIE_COMMUNICATION,BU.Building,BORNE_REPERE&format=image/png&crs=EPSG:3945&
bbox=1646753.1324380166,4187923.8388985507,1665103.1667975208,4196356.24&width=1000&height=650&styles &QUER
Y_LAYERS=CP.CadastralParcel&INFO_FORMAT=text/html&I=500&J=
En cas d'erreur, un message codifié du type HTTP XXX est retourné.
Les significations de ces codifications sont les suivantes :

- Pour les codes : http 400, 404, 405, 406 et 408, il s’agit de requêtes WMS mal formées,
- Pour les codes : http 401, 402, 403 et 407 il s’agit de requêtes WMS non autorisées.


