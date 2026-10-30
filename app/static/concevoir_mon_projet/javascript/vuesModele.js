const TypeOmbrière = document.getElementById("TypeOmbrière").value

//ROUTES POUR LES GRAPHES
var fichier = localStorage.getItem('fichier')

var Calepinage = `static/concevoir_mon_projet/graphes/${fichier}_calepinage.png#toolbar=0`
var a = document.getElementById('Calepinage')
a.src = Calepinage

var Coupe = `static/concevoir_mon_projet/graphes/${fichier}_coupe.png#toolbar=0`
var b = document.getElementById('Coupe')
b.src = Coupe

const CoupeTransversaleBardage = ['Type2', 'Type30', 'Type40']
if (CoupeTransversaleBardage.includes(TypeOmbrière)){
  var CoupeBardage = `static/concevoir_mon_projet/graphes/${fichier}_CoupeTransversaleBardage.png#toolbar=0`
  var c = document.getElementById('CoupeTransversaleBardage')
  c.src = CoupeBardage
}

var Facades = `static/concevoir_mon_projet/graphes/${fichier}_facade.png#toolbar=0`
var d = document.getElementById('Facade')
d.src = Facades


var Implantation = `static/concevoir_mon_projet/graphes/${fichier}_implantation.png#toolbar=0`
var e = document.getElementById('ImplantationMassifs')
e.src = Implantation

const ParkingsOmbrières = ['Type1', 'Type2', 'Type3', 'Type4', 'Type5', 'Type30', 'Type40']
if (ParkingsOmbrières.includes(TypeOmbrière)){
  var EmplacementParkings = `static/concevoir_mon_projet/graphes/${fichier}_EmplacementParkings.png#toolbar=0`
  var f = document.getElementById('EmplacementParkings')
  f.src = EmplacementParkings
}

var Empannage = `static/concevoir_mon_projet/graphes/${fichier}_empannage.png#toolbar=0`
var g = document.getElementById('Empannage')
g.src = Empannage

