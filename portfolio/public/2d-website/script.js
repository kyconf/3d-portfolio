const projects = [
  {
    title: "Interactive BMO Bot",
    desc: "A real-life 3D-printed BMO assembled using a Raspberry Pi and other hardware components. Can execute a number of voice-enabled commands via a pattern recognition model. Commands include getting the weather, estimated bus arrival times, and work schedules for the week.",
    tech: ["Python", "piper-tts", "vosk", "weather-api", "ttc-bus-api", "google-calendar-api"],
    color: "bg-primary",
    github: "https://github.com/kyconf/bmo-os-mini",
  },
  {
    title: "asl sign language interpreter",
    desc: "A real-time computer vision application that utilizes OpenCV and Python to detect and translate American Sign Language gestures into text.",
    tech: ["python", "flask", "opencv"],
    color: "bg-secondary",
    github: "https://github.com/EthanConstantin/SLInterpreter",
  },
  {
    title: "3-D PORTFOLIO",
    desc: "A 3D interactive scene of my 'ideal room' built with Three.js and Vite. Combines both 3D Blender scenes with 2D static websites.",
    tech: ["blender", "html/css/js", "three.js", "Vite"],
    color: "bg-accent",
    github: "https://github.com/kyconf/3d-portfolio",
  },
  {
    title: "yorku event hub",
    desc: "Centralized platform for York University students to discover and promote campus events by aggregating data from student clubs, Discord, and Instagram into a unified calendar for students to view. ",
    tech: ["nextjs", "python + fastapi", "postgresql", "supabase"],
    color: "bg-destructive",
    github: "https://github.com/kyconf/project-yuevents",
  },
    {
    title: "beyond education sat simulator",
    desc: "Developed a full-stack SAT test simulator featuring real-time answer syncing, session-based resumption, and automated score calculation to mimic official testing environments.",
    tech: ["react", "javascript", "tailwind css", "firebase", "firestore"],
    color: "bg-blue",
    preview: "/sat_simulation.mp4",
    },
    {
    title: "ml-automation-classifier & transcriber",
    desc: "An AI-driven exam automation tool created to reduce test preparation time. Utilizes a React front-end and Node.js backend to extract, transcribe, and parse text and images from PDF into Google Sheets. Implements a fine-tuned FLAN-T5 model in Python to classify complex multi-input questions by difficulty, passage type, and format. Uses the OpenAI API to generate / regenerate new questions & scan images.",
    tech: ["react", "node.js", "python", "sheets api", "drive api"],
    color: "bg-purple",
    github: "https://github.com/kyconf/ml-automation-classifier-transcriber",
    }

];

document.addEventListener("DOMContentLoaded", () => {
    const navItems = document.querySelectorAll(".nav-item");
    const sections = document.querySelectorAll(".page-section");
    const projectsGrid = document.getElementById("projects-grid");

    // 1. Generate the Project Cards
    projectsGrid.innerHTML = projects.map(p => `
        <div class="pixel-box pixel-card animate-fade-in-up${p.preview ? ' has-preview' : ''}">
            <div class="color-strip ${p.color}"></div>
            <h3 class="project-title">${p.title}</h3>
            <p class="project-desc">${p.desc}</p>
            <div class="tag-container">
                ${p.tech.map(t => `<span class="tag">${t}</span>`).join('')}
                ${p.github ? `<a href="${p.github}" target="_blank" rel="noopener noreferrer" class="tag github-btn" title="View on GitHub"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="display:block"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg></a>` : ''}
            </div>
            ${p.preview ? `<div class="card-preview-overlay"><video class="card-preview-video" src="${p.preview}" muted loop playsinline preload="none"></video></div>` : ''}
        </div>
    `).join('');

    // Video preview hover logic
    projectsGrid.querySelectorAll('.has-preview').forEach(card => {
        const video = card.querySelector('.card-preview-video');
        card.addEventListener('mouseenter', () => { video.play(); });
        card.addEventListener('mouseleave', () => { video.pause(); video.currentTime = 0; });
    });

    // 2. Navigation Logic
    navItems.forEach(item => {
        item.addEventListener("click", (e) => {
            e.preventDefault();
            const targetId = item.getAttribute("data-target");

            // Remove active class from all items and add to clicked one
            navItems.forEach(nav => nav.classList.remove("active"));
            item.classList.add("active");

            // Hide all sections and show target
            sections.forEach(section => {
                section.style.display = section.id === targetId ? "block" : "none";

            
            
            });

            if (targetId === "skills") {
                renderSkills();
                animateAllSkills();
                setupScrollHint();
            } else {
                hideScrollHint();
            }
        });
    });
});

const skillCategories = [
    {
        label: "LANGUAGES",
        skills: [
            { name: "Python",      level: 9 },
            { name: "Java",  level: 8 },
            { name: "HTML/CSS/JavaScript",  level: 8 },
            { name: "TypeScript",  level: 7 },
 
            { name: "SQL",  level: 9 },
            { name: "C",  level: 6 },
            { name: "LUAU",  level: 6 },
        ]
    },
    {
        label: "FRAMEWORKS & LIBRARIES",
        skills: [
            { name: "React",       level: 8 },
            { name: "Node.js",     level: 7 },
            { name: "Next.js",     level: 7 },
            { name: "Three.js",     level: 7 },
            { name: "Flask",       level: 7 },
        ]
    },
    {
        label: "DATABASES",
        skills: [
            { name: "PostgreSQL",  level: 8 },
            { name: "MySQL",       level: 9 },
            { name: "Supabase",    level: 7 },
            { name: "Firebase",    level: 7 },
            { name: "Azure",    level: 6 },
        ]
    },
    {
        label: "TOOLS & OTHER",
        skills: [
            { name: "Git",         level: 8 },
            { name: "Figma",       level: 6 },
            { name: "Shopify",     level: 7 },
            { name: "Blender",     level: 8 },
        
        ]
    },
    {
        label: "MANAGEMENT",
        skills: [
            { name: "Jira",        level: 7 },
            { name: "Trello",      level: 8 },
        ]
    }
];

function getFlavorText(level) {
    if (level >= 9) return "MASTER";
    if (level >= 8) return "ADVANCED";
    if (level >= 7) return "PROFICIENT";
    if (level >= 6) return "COMPETENT";
    if (level >= 5) return "APPRENTICE";
    return "NOVICE";
}

function animateCounter(el, target, duration = 1000) {
    let start = 0;
    const step = target / (duration / 16);
    const tick = () => {
        start = Math.min(start + step, target);
        el.textContent = `LV.${Math.floor(start)}`;
        if (start < target) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

function renderSkills() {
    const container = document.getElementById('skills-container');

    const totalSkills = skillCategories.flatMap(c => c.skills);
    const avg = (totalSkills.reduce((a, s) => a + s.level, 0) / totalSkills.length).toFixed(1);

    container.innerHTML = `
        <div class="skills-summary">
            <span>AVG LV: <strong>${avg}</strong></span>
            <span>//</span>
            <span>SKILLS UNLOCKED: <strong>${totalSkills.length}</strong></span>
        </div>
        <div class="skills-grid">
            ${skillCategories.map(cat => `
                <div class="pixel-box skill-category-box">
                    <div class="skill-category-label">[ ${cat.label} ]</div>
                    ${cat.skills.map(s => `
                        <div class="skill-item">
                            <div class="skill-info">
                                <span class="skill-name">${s.name}</span>
                                <span class="skill-level" data-target="${s.level}">LV.0</span>
                            </div>
                            <div class="progress-bg">
                                <div class="progress-fill" data-level="${s.level}" style="width: 0%"></div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `).join('')}
        </div>
    `;
}

function animateAllSkills() {
    setTimeout(() => {
        document.querySelectorAll('.progress-fill').forEach(fill => {
            const level = fill.getAttribute('data-level');
            fill.style.width = (level / 10) * 100 + '%';
        });
        document.querySelectorAll('.skill-level[data-target]').forEach(el => {
            animateCounter(el, parseInt(el.getAttribute('data-target')));
        });
    }, 50);
}

function setupScrollHint() {
    const scroller = document.querySelector('.content-section');
    const hint = document.getElementById('skills-scroll-hint');
    if (!scroller || !hint) return;

    const check = () => {
        const canScroll = scroller.scrollHeight > scroller.clientHeight;
        const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 10;
        hint.classList.toggle('visible', canScroll);
        hint.classList.toggle('hidden', atBottom);
    };

    scroller.addEventListener('scroll', check);
    setTimeout(check, 150);
}

function hideScrollHint() {
    const hint = document.getElementById('skills-scroll-hint');
    if (hint) { hint.classList.remove('visible'); hint.classList.add('hidden'); }
}