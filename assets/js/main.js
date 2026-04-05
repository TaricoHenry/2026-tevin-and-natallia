const baseUrl = "https://us-central1-tevin-wedding.cloudfunctions.net:443/api/v1/"
let params = new URLSearchParams(document.location.search);
const token = params.get("token");

window.onload = startLoad();

function startLoad() {
    const submit =  document.getElementById("submit")
    if (submit) {
        show = setTimeout(showPage, 2000);
        checkTokenStatus();
        }
    const redirect = document.getElementById("redirect")
    if (redirect) {
        redirect.href = "/?token="+token;
    }
}

function showPage() {
  document.getElementsByClassName("welcome")[0].style.display = "flex";
  document.getElementsByClassName("story")[0].style.display = "flex";
  document.getElementsByClassName("invitation")[0].style.display = "flex";
}



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

//START Check Token Status

async function checkTokenStatus() {
    if (token == null) {
        document.getElementById("submit").style.display = "none";     
        return;
    }
    var url = (baseUrl + 'token/' + token + '/status');
    //baseUrl and token declared at the top

    try {
    const response = await fetch(url, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
        }
    })
    let tokenStatusBody = await response.json();
        if (tokenStatusBody.valid == false) {
            document.getElementById("submit").style.display = "none";     
        }
        else if (tokenStatusBody.used == false && tokenStatusBody.valid == true) {
            populateTokenData();
        }
        else if (tokenStatusBody.used == true && tokenStatusBody.valid == true) {
            // this says if the token is used, retrieve it anyway. It renders it like normal, but after populateTokenData() it disables all the buttons and inputs.
            let res = await populateTokenData();
            document.getElementsByClassName("rsvp")[0].classList.add("disabled")
            let button = document.getElementById("submit")
            button.value = "Submitted";
            button.disabled = true;
            let checkboxes = document.getElementsByClassName("guest-checkbox")
            for (i of checkboxes) {
                i.disabled = true;
            }

        }

    } catch (error) {
        console.error(error.message);
    }
}

//END Check Token Status


//START Populate Token Code

async function populateTokenData() {
    var url = (baseUrl + 'token/' + token);
    //baseUrl and token declared at the top

    try {
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
            }
        })
        let tokenDetailsBody = await response.json();
        var guestBoxes = "";

        for ( i of tokenDetailsBody.members) {
            let checkedStatus =  i.rsvp == "yes" ? "checked" : "";
            let boxStatus = i.rsvp == "yes" ? "toggled" : "";
            guestBoxes = guestBoxes + 
            `            
                <div class="guest-box ${boxStatus}">
                    <label for="${i.memberId}">
                        ${i.personalizedAddy}
                    </label>
                    <input id="${i.memberId}" class="guest-checkbox" type="checkbox" ${checkedStatus}/>
                </div>
            `
        }

        document.getElementsByClassName("rsvp")[0].innerHTML =
            `
            <p>Kindly let us know who will be attending:</p>
            </br>
            </br>
            ${guestBoxes}
            <input id="submit" type="button" value="Submit" onclick="submitResponse()">
            `;

        document.getElementsByClassName("household")[0].innerHTML = tokenDetailsBody.household;

    } catch (error) {
        console.error(error.message);
    }
    const checkboxes = document.getElementsByClassName("guest-checkbox");
    for (i of checkboxes) {
        i.addEventListener("click", (event) => {
            event.target.parentNode.classList.toggle("toggled");
        });
    }
}

//END Populate Token Code

//START Submit Code

async function submitResponse() {
    document.getElementById("submit").value = "Submitting...";
    boxes =  Array.from(document.getElementsByClassName("guest-checkbox"))

    const submissionArray = boxes.map(guest => ({
        memberId: guest.id,
        rsvp: guest.checked == true ? "yes" : "no"
    }))

    try {
        let url = baseUrl + 'token/' + token + '/reply'
        //baseUrl and token declared at the top
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ responses: submissionArray })
        });
        const result = await response.json();
        console.log(result);
        setTimeout(() => {
            window.location.replace("/thank-you?token="+token);
        }, 1500);

    }
    catch (error) {
        console.error(error.message);
    }
}
//END Submit Code
