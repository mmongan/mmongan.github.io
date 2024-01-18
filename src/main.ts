import './style.css'
import { setupWorld } from './world.ts'



document.querySelector<HTMLDivElement>('#app')!.innerHTML = `  
<canvas id="canvas"></canvas>
`;


setupWorld(document.getElementById("cavas") as HTMLCanvasElement);
