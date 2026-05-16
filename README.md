
# kyle's portfolio

An immersive, interactive 3D portfolio website that projects a digital representation of my "ideal room"! This project merges traditional 2D web development with web-based 3D graphics via Vite + Three.JS, allowing users to explore projects, skills, and experience by interacting with objects inside a virtual space.

To start, simply press BMO's screen to be sent into the virtual 2D portfolio (or go straight there via the 'Choose your Experience' screen).

May work differently depending on the browser, operating system, and or specifications of your computer.

---

## features

*   **Immersive 3D Scene:** A fully realized 3D room environment built using custom-modeled assets optimized for the web.
*   **Interactive Hotspots:** Clickable 3D objects within the environment that dynamically trigger and render seamless 2D web interfaces (overlays/modals) for deep-dives into projects and experience.
*   **Optimized Performance:** Highly efficient rendering achieved through texture baking, low-poly modeling, and asset compression.
*   **Responsive Hybrid Design:** A fluid UI layout that gracefully handles 3D canvas scaling alongside responsive 2D HTML/CSS overlays for mobile and desktop devices.

---

## tech stack

### Frontend & 3D Rendering
*   **React:** Component-based UI architecture.
*   **Three.js:** The core WebGL library used to render the 3D scene, lighting, and cameras.
*   **React Three Fiber (R3F):** A React wrapper for Three.js, allowing declarative scene construction.
*   **@react-three/drei:** Useful helpers and abstractions for working with R3F (e.g., OrbitControls, loader helpers).

### 3D Asset Pipeline
*   **Blender:** Used for 3D modeling, UV mapping, texture baking, and optimizing geometry.
*   **GLTF/GLB:** The runtime asset format utilized for efficient delivery and loading of 3D models over the web.

---

## credits
Some assets were taken directly from Sketchfab. Attributed under CC. Most of the assets were created by me personally in Blender. 

