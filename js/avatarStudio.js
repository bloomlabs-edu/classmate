const STYLE = "personas";

let selectedSeed = "ClassMate";

const preview = document.getElementById("avatarPreview");
const gallery = document.getElementById("avatarGallery");

function randomSeed(length = 8) {

    const chars =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    let seed = "";

    for (let i = 0; i < length; i++) {

        seed += chars[Math.floor(Math.random() * chars.length)];

    }

    return seed;

}

function avatarUrl(seed) {

    return `https://api.dicebear.com/9.x/${STYLE}/svg?seed=${seed}`;

}

function renderPreview() {

    preview.src = avatarUrl(selectedSeed);

}

function buildGallery() {

    gallery.innerHTML = "";

    for (let i = 0; i < 12; i++) {

        const seed = randomSeed();

        const img = document.createElement("img");

        img.src = avatarUrl(seed);

        img.className = "galleryAvatar";

        img.onclick = () => {

            selectedSeed = seed;

            renderPreview();

            document.querySelectorAll(".galleryAvatar")
                .forEach(a => a.classList.remove("selected"));

            img.classList.add("selected");

        };

        gallery.appendChild(img);

    }

}

document.getElementById("refreshBtn").onclick = () => {

    buildGallery();

};

document.getElementById("continueBtn").onclick = () => {

    alert("Selected avatar seed: " + selectedSeed);

};

buildGallery();

renderPreview();