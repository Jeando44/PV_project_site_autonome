/**
 * Déclenchement d'un téléchargement depuis un Blob déjà construit en mémoire.
 *
 * Partagé par les deux points d'entrée des exports de plans — le modal « Exporter les plans en PDF
 * et DXF » (ExportPlansModal.js) et le bouton « Exporter le plan de masse en DXF » du configurateur
 * Petit champ solaire (PlanDeMassePont.js) — pour qu'ils produisent le même comportement de
 * téléchargement. (Le dossier DP et le dossier petit champ ont leur propre helper, dans une chaîne
 * de modules qu'on ne veut pas charger ici juste pour ces quelques lignes.)
 */
export default function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
