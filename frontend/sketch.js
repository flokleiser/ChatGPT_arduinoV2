
let font;

function preload() {
    // Load the font
    //font = loadFont('/assets/RobotoMono.otf');
}

function setup() {
    createCanvas(windowWidth, windowHeight);
    background(100, 100, 100);
    //textFont(font);
    //frontendFunctions["start_party"]();
}

function draw() {
    // Display the message on the canvas
    background(0); // Clear the canvas
    push()
    stroke(255);
    noFill();
    //circle((width / 2), (height / 2), max(width, height) + 5);
}

function simpleTruchetPatern() {
    noFill();
    let spacing = 40; // Spacing between arcs
    stroke(255, 255, 255, 30);
    strokeWeight(2);
    //
    push();

        for (let x = 0; x < width; x += spacing) {
            for (let y = 0; y < height; y += spacing) {
                randomSeed(x * y);
                let r = random(1);
                if (r > 0.5) {
                    arc(x + spacing, y, spacing, spacing, HALF_PI, PI);
                    arc(x, y + spacing, spacing, spacing, -HALF_PI, 0);
                } else {
                    arc(x + spacing, y + spacing, spacing, spacing, PI, -HALF_PI);
                    arc(x, y, spacing, spacing, 0, HALF_PI);
                }
            }
        }
    pop();
}

function backgroundFill() {
    // diagonal limes at 45 degrees   
    background(255, 255, 0);
    for (let i = 0; i < width + height; i += 25) {
        stroke(0, 255, 255);
        strokeWeight(8);
        line(i, 0, 0, i);
        noStroke();
        //line(0, i, width, height - i);
    }
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
}

