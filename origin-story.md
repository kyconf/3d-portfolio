# Origin Story — saved for later

Paste this block into `front.html` inside `#about`, right after the closing `</div>` of `.about-grid` and before the closing `</div>` of `#about`.

## HTML snippet

```html
<!-- Biography / Origin Story -->
<div class="pixel-box origin-box">
    <p class="stat-header">📜 ORIGIN_STORY</p>
    <div class="origin-chapters">
        <div class="origin-chapter">
            <span class="origin-label">[ CHAPTER 1 — THE SPARK ]</span>
            <p>Ever since I was young, I've always been a curious person — always wondering how this or that worked. I loved messing around with things, breaking them apart, building them back together. I also loved games. Those two finally connected when I first downloaded Minecraft. I modded things, spun up my own server, created my first ever video game. I touched my first programming language through Xcode, just tinkering around.</p>
        </div>
        <div class="origin-chapter">
            <span class="origin-label">[ CHAPTER 2 — THE CALL ]</span>
            <p>Then came sixth grade — my "Computer Class" teacher was teaching us Swift using Swift Playgrounds. My first real introduction to game development and programming languages. At the end of the year, she picked me out of the class and asked if I wanted to participate in Apple's WWDC. At the time, I had no idea how big a deal that was, so I said yes without hesitation. From that moment on, I knew I had a profound love for anything computer-related. I built my first PC in 2020, and the rest started falling into place.</p>
        </div>
        <div class="origin-chapter">
            <span class="origin-label">[ CHAPTER 3 — THE LEAP ]</span>
            <p>Fast forward to 2023 — I took a massive leap by getting accepted into York University for a BSc Specialized Honours in Computer Security. Honestly, a gutsy move. Growing up, I never planned on going into cybersecurity; I always thought I'd stick strictly to game development or general CS. But I had this sudden impulse to break out of my comfort zone and try something completely different. So I took the shot — and it opened up a whole new world.</p>
        </div>
    </div>
</div>
```

## CSS snippet

Add this to `externals.css` after `.quest-dot { ... }`:

```css
/* Origin Story / Biography */
.origin-box {
    margin-top: 24px;
    padding: 24px;
    background: #1a1a1a;
}

.origin-chapters {
    display: flex;
    flex-direction: column;
    gap: 24px;
}

.origin-chapter {
    border-left: 2px solid var(--green);
    padding-left: 16px;
}

.origin-label {
    display: block;
    color: var(--green);
    font-family: 'Silkscreen', sans-serif;
    font-size: 9px;
    letter-spacing: 1px;
    margin-bottom: 10px;
}

.origin-chapter p {
    font-family: 'DM Mono', monospace;
    font-size: 13px;
    line-height: 1.9;
    color: #ccc;
    margin: 0;
}
```
