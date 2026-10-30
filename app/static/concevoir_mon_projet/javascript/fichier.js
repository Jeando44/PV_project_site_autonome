
const btn1 = document.getElementById("Btn1")
const Dlg1 = document.getElementById("Dlg1")
const Btn1Close = document.getElementById("BtnC1")
const Bmodifier= document.getElementById("modifier")

btn1.onclick = function () {
  const JsonParamètresProjet = localStorage.getItem('ParamètresProjet')
  const ObjParamètresProjet = JSON.parse(JsonParamètresProjet)

  for (const key in ObjParamètresProjet){
    if (document.getElementById(key)){
      document.getElementById(key).value= ObjParamètresProjet[key]
    }
  }

  /*document.getElementById('NomProjet').value = localStorage.getItem('NomProjet')
  document.getElementById('adresse').value = localStorage.getItem('adresse')
  document.getElementById('auteur').value = localStorage.getItem('auteur')*/

  Dlg1.showModal()
}

Btn1Close.onclick = function () {
  Dlg1.close()
}

Bmodifier.onclick = function () {
  const ParamètresProjet= document.getElementById('ParamètresProjet')
  const fdParamètresProjet = new FormData(ParamètresProjet)
  const objParamètresProjet = Object.fromEntries(fdParamètresProjet)
  const jsonParamètresProjet = JSON.stringify(objParamètresProjet)
  localStorage.setItem('ParamètresProjet', jsonParamètresProjet)


  /*localStorage.setItem('NomProjet', document.getElementById('NomProjet').value)
  localStorage.setItem('adresse', document.getElementById('adresse').value)
  localStorage.setItem('auteur', document.getElementById('auteur').value)*/
  
  Dlg1.close()
}


const input = document.getElementById('LogoEntreprise');
input.addEventListener('change', (event) => {
    const image = event.target.files[0];
    const reader = new FileReader();
    reader.readAsDataURL(image);
    reader.addEventListener('load', () => {
      localStorage.setItem('LogoEntreprise', reader.result)
      localStorage.setItem('NomLogoEntreprise', (document.getElementById('LogoEntreprise').value).split("\\").pop())

    })
})

var LogoEntreprise = localStorage.getItem('LogoEntreprise');
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