var countDownDate = new Date("Jul 25, 2026 14:00:00").getTime();
var x = setInterval(function() {

    // Get today's date and time
    var now = new Date().getTime();

    // Find the distance between now and the count down date
    var distance = countDownDate - now;

    // Time calculations for days, hours, minutes and seconds
    var time = [
        Math.floor(distance / (1000 * 60 * 60 * 24)),
        Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
        Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60)),
        Math.floor((distance % (1000 * 60)) / 1000)
        ]
    // Display the result in the element with class="int"
    const ints = document.getElementsByClassName("int")

    for (let i=0; i< ints.length; i++) {
        ints[i].innerHTML = time[i];
    }

}, 1000);

//START fade in code

const observer = new IntersectionObserver((entries)=>{
    entries.forEach((entry)=>{
        if (entry.isIntersecting) {
            console.log(entry.target)
            entry.target.classList.add("appear")
        }
    })
},{})

const animElements = document.querySelectorAll(".fadein")
animElements.forEach(el => observer.observe(el))

//END fade in code

//START checkbox code

function checked() {
    var box = window.event.target;
    console.log(box);
}

//END checkbox code

async function checkToken() {
    url = ('https://us-central1-ash-wedding.cloudfunctions.net:443/api/v1/token/EXRRQC/status')
    try {
        const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                }
            })
        console.log(response)
    } catch (error) {
        console.error(error.message);
    }
}