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

async function checkToken() {
    let params = new URLSearchParams(document.location.search);
    let token = params.get("token");
    console.log(token);
    var url = ('https://us-central1-tevin-wedding.cloudfunctions.net:443/api/v1/token/'+token+'/status');

    try {
        const response = await fetch(url, {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                }
            })
        console.log(response)
    } catch (error) {
        console.error(error.message);
    }
}

const sampleResponse = {
    "isSuccess": true,
    "token": "AB12CD",
    "household": "The Smith Family",
    "householdSize": 2,
    "allResponded": false,
    "members": [
        {
            "memberId":"abc123",
            "name":"personA Smith",
            "personalizedAddy":"Mr personA",
            "rsvp":false,
            "respondedAt":"11:59"
        },
        {
            "memberId":"abc124",
            "name":"personB Smith",
            "personalizedAddy":"Mr personB",
            "rsvp":false,
            "respondedAt":"11:59"
        }
        
    ]
}

//START Parse JSON Code

var guestBoxes = ""

for ( i of sampleResponse.members) {
    guestBoxes = guestBoxes + 
    `            
        <div class="guest-box">
            <label for="${i.memberId}">
                ${i.personalizedAddy}
            </label>
            <input id="${i.memberId}" class="guest-checkbox" type="checkbox"/>
        </div>
    `
}

document.getElementsByClassName("rsvp")[0].innerHTML =
    `
    <p>Kindly let us know who will be attending:</p>
    </br>
    </br>
    ${guestBoxes}
    <input id="submit" type="button" value="Submit" onclick="checkToken()">
    `;

//END Parse JSON Code

//START checkbox code

const checkboxes = document.getElementsByClassName("guest-checkbox");
for (i of checkboxes) {
    i.addEventListener("click", (event) => {
        event.target.parentNode.classList.toggle("toggled");
    });
}

//END checkbox code
