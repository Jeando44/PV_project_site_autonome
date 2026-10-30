var LogoEntreprise = localStorage.getItem('LogoEntreprise')
var NomLogoEntreprise = localStorage.getItem('NomLogoEntreprise')
if (LogoEntreprise) {
   
    // Get a reference to our file input
    const fileInput = document.getElementById('LogoEntreprise');

    // Create a new File object
    const dataUrl = localStorage.getItem('LogoEntreprise')
    fetch(dataUrl)
    .then(response => response.blob())
    .then(blob => {
        const myFile = new File([blob], NomLogoEntreprise, {type: blob.type})
        // Now let's create a DataTransfer to get a FileList
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(myFile);
        fileInput.files = dataTransfer.files;
    })
}




//BOUTTONS DIALOGUES
const btn1 = document.getElementById("Btn1")
const Dlg1 = document.getElementById("Dlg1")
const Btn1Close = document.getElementById("BtnC1")

btn1.onclick = function () {
    
    if (localStorage.getItem('format') !=null){
        document.getElementById('format').value = localStorage.getItem('format')
    }
    if (localStorage.getItem('papier') ==null){
        document.getElementById('papier').value = 'A3'
    } else{
        document.getElementById('papier').value = localStorage.getItem('papier')
    }

    if (localStorage.getItem('OrientationFeuille') !=null){
        document.getElementById('OrientationFeuille').value = localStorage.getItem('OrientationFeuille')
    }

    const checkedValues = JSON.parse(localStorage.getItem('checkedValuesExport'))
    if (checkedValues) {
        const checkboxes = document.querySelectorAll('input[type="checkbox"]')
        checkboxes.forEach(function (checkbox) {
            if (checkedValues.includes(checkbox.value)) {
                checkbox.checked = true
            }
        })
    }
    
    //PARAMETRES
    document.getElementById('ParamètresProjet').value = localStorage.getItem('ParamètresProjet')
    document.getElementById('ParamètresModele').value = localStorage.getItem('ParamètresModele')
    document.getElementById('ParamètresPlanMasse').value = localStorage.getItem('ParamètresPlanMasse')
    document.getElementById('ParamètresVérification').value = localStorage.getItem('ParamètresVérification')

    if (localStorage.getItem('ParamètresPlanMasse') == null){
        document.getElementById('PlanMasseToiture').checked = false
        document.getElementById('PlanMasseToiture').disabled = true

        document.getElementById('PlanMasseMassifs').checked = false
        document.getElementById('PlanMasseMassifs').disabled = true
    }
    
    if (localStorage.getItem('ParamètresVérification') == null){
        document.getElementById('noteCalcul').checked = false
        document.getElementById('noteCalcul').disabled = true
    }

    Dlg1.showModal()
    //document.getElementById("Btn11").removeAttribute('disabled','')
}

Btn1Close.onclick = function () {
    Dlg1.close()
}

const DlgEVA = document.getElementById("DEVA")
function generer(){
    
    localStorage.setItem('format', document.getElementById('format').value)
    localStorage.setItem('papier', document.getElementById('papier').value)
    localStorage.setItem('OrientationFeuille', document.getElementById('OrientationFeuille').value)

    const checkboxes = document.querySelectorAll('input[type="checkbox"]')
    let checkedValues = []
    checkboxes.forEach(function (checkbox) {
        if (checkbox.checked) {
            checkedValues.push(checkbox.value)
        }
    })
    localStorage.setItem('checkedValuesExport', JSON.stringify(checkedValues))

    let form = document.getElementById("FormParamètresExport");
    form.submit()

    //document.getElementById("Btn11").setAttribute('disabled','')


}

const JsonParamètresModele = localStorage.getItem('ParamètresModele')
const ObjParamètresModele = JSON.parse(JsonParamètresModele)
const TypeOmbrière = ObjParamètresModele['TypeOmbrière']
const ParkingsOmbrières = ['Type1', 'Type2', 'Type3', 'Type4', 'Type5', 'Type30', 'Type40']

if (ParkingsOmbrières.includes(TypeOmbrière)){
    document.getElementById('ExportPlanParkings').removeAttribute('hidden', '')
    //document.getElementById('Parkings').checked = true

} else{
    document.getElementById('ExportPlanParkings').setAttribute('hidden', '')
    document.getElementById('Parkings').checked = false
}





//EXPORTER PLANS EN DXF
if (TypeOmbrière!='Type4'){
    document.getElementById("Btn21").setAttribute('hidden', '')
    document.getElementById("divFormatDxf").setAttribute('hidden', '')
} else{
    document.getElementById("divNonDisponible").setAttribute('hidden', '')
}

const Btn2 = document.getElementById("Btn2")
const Dlg2= document.getElementById("Dlg2")
const Btn2Close = document.getElementById("BtnC2")

Btn2.onclick = function () {
    document.getElementById('ParamètresModeleDXF').value = localStorage.getItem('ParamètresModele')
    Dlg2.showModal()
}

Btn2Close.onclick = function () {
    Dlg2.close()
}

function genererDXF(){
    let form = document.getElementById("FormParamètresExportDXF");
    form.submit()
}


/*
var fichier = localStorage.getItem('fichier')
var format = localStorage.getItem('format')
if (format=="docx"){
    var b =`static/ombridesign/rapport/${fichier}.docx`
    var a = document.getElementById('rapport')
    a.href = b
}
else if (format=='pdf') {
    var b =`static/ombridesign/rapport/${fichier}.pdf`
    var a = document.getElementById('rapport')
    a.href = b

}*/
  