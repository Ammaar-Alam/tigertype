import typingSound from '../assets/typing.mp3';

const keySound = new Audio(typingSound);

function playKeySound() {
    const shouldPlaySound = localStorage.getItem('typingSound') === 'true';
    if (shouldPlaySound) {
        keySound.currentTime = 0;
        keySound.volume = 0.2;
        keySound.play();
    }
}

export default playKeySound;
