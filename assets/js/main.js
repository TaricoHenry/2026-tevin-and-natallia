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

