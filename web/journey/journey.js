/* Transfer journey: intake form -> ticket -> train arrives -> doors open -> zoom through the door
 * -> ride forward along the tracks. The station is drawn on a canvas in the 1448x1086 space of the
 * source photos; the track ride is a WebGL shader that pushes the camera toward the vanishing point. */
(() => {
  "use strict";

  // ------------------------------------------------------------------ data
  const COLLEGES = {
    "Chabot College": "Hayward", "Las Positas College": "Livermore", "Ohlone College": "Fremont",
    "Diablo Valley College": "Pleasant Hill", "Contra Costa College": "San Pablo", "Los Medanos College": "Pittsburg",
    "Laney College": "Oakland", "Merritt College": "Oakland", "College of Alameda": "Alameda",
    "Berkeley City College": "Berkeley", "De Anza College": "Cupertino", "Foothill College": "Los Altos Hills",
    "Mission College": "Santa Clara", "West Valley College": "Saratoga", "Evergreen Valley College": "San Jose",
    "San José City College": "San Jose", "City College of San Francisco": "San Francisco", "Skyline College": "San Bruno",
    "College of San Mateo": "San Mateo", "Cañada College": "Redwood City", "Santa Rosa Junior College": "Santa Rosa",
    "College of Marin": "Kentfield", "Napa Valley College": "Napa", "Solano Community College": "Fairfield",
    "Sacramento City College": "Sacramento", "American River College": "Sacramento", "Cosumnes River College": "Sacramento",
    "Folsom Lake College": "Folsom", "Sierra College": "Rocklin", "San Joaquin Delta College": "Stockton",
    "Modesto Junior College": "Modesto", "Fresno City College": "Fresno", "Bakersfield College": "Bakersfield",
    "Cabrillo College": "Aptos", "Hartnell College": "Salinas", "Monterey Peninsula College": "Monterey",
    "Gavilan College": "Gilroy", "Santa Barbara City College": "Santa Barbara", "Moorpark College": "Moorpark",
    "Ventura College": "Ventura", "College of the Canyons": "Santa Clarita", "Santa Monica College": "Santa Monica",
    "Pasadena City College": "Pasadena", "Glendale Community College": "Glendale", "Los Angeles City College": "Los Angeles",
    "East Los Angeles College": "Monterey Park", "El Camino College": "Torrance", "Long Beach City College": "Long Beach",
    "Cerritos College": "Norwalk", "Citrus College": "Glendora", "Mt. San Antonio College": "Walnut",
    "Chaffey College": "Rancho Cucamonga", "Riverside City College": "Riverside", "Fullerton College": "Fullerton",
    "Orange Coast College": "Costa Mesa", "Golden West College": "Huntington Beach", "Santa Ana College": "Santa Ana",
    "Santiago Canyon College": "Orange", "Irvine Valley College": "Irvine", "Saddleback College": "Mission Viejo",
    "MiraCosta College": "Oceanside", "Palomar College": "San Marcos", "San Diego City College": "San Diego",
    "San Diego Mesa College": "San Diego", "Grossmont College": "El Cajon", "Southwestern College": "Chula Vista",
    "Butte College": "Oroville", "Shasta College": "Redding",
  };
  const UNIVERSITIES = [
    "UC Berkeley", "UCLA", "UC San Diego", "UC Davis", "UC Irvine", "UC Santa Barbara", "UC Santa Cruz",
    "UC Riverside", "UC Merced", "Cal State East Bay", "San José State University", "San Francisco State University",
    "Cal Poly San Luis Obispo", "Cal Poly Pomona", "Sacramento State", "CSU Long Beach", "CSU Fullerton",
    "San Diego State University", "Stanford University", "USC",
  ];

  // ------------------------------------------------------------------ timeline (seconds)
  const T = {
    fadeIn: [0, 0.8],
    ticketIn: [0.7, 2.3],
    punch: 2.6,
    train: [2.8, 7.2],
    settle: [7.2, 7.6],
    doors: [8.0, 9.3],
    ticketToDoor: [8.9, 10.2],
    zoom: [9.6, 12.0],
    flashIn: [11.2, 12.0],
    ride: [12.0, 25.0],
    flashOut: [12.0, 12.9],
    steer: [14.6, 20.2],
    fadeOut: [20.8, 25.4],
  };
  const END = T.fadeOut[1] + 0.35;            // hold on black briefly, then hand off to the next page
  // which branch the switch sends us down: -1 = left (toward the sea), +1 = right (along the platform)
  const ROUTE = -1;

  // station geometry (pixels in the 1448x1086 photo space)
  const STAGE_W = 1448, STAGE_H = 1086;
  const SEG_X0 = 130, SEG_W = 1225, STRIP_TOP = 296;
  const DOOR = { x: 752, y: 425, w: 279, h: 427, split: 891 };
  const DOOR_FOCUS = { x: 891, y: 640 };
  const SIGN = { x: 510, y: 405, w: 144, h: 33 };
  const TRAIN_START_OFFSET = 2750;
  const TICKET_REST = { x: 560, y: 712, rot: -4 };

  // track photo geometry
  const TRACK_IMG = { w: 1672, h: 941 };
  const TRACK_VP = { x: 868, y: 425 };

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ------------------------------------------------------------------ helpers
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const prog = (t, [a, b]) => clamp((t - a) / (b - a), 0, 1);
  const easeOutCubic = (u) => 1 - Math.pow(1 - u, 3);
  const easeInCubic = (u) => u * u * u;
  const easeInOutCubic = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
  const easeInOutSine = (u) => -(Math.cos(Math.PI * u) - 1) / 2;

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not load " + src));
      img.src = src;
    });
  }

  const ASSET_SRC = {
    bg: "assets/station_bg.webp", fg: "assets/station_fg.png", strip: "assets/train_strip.png",
    closed: "assets/station_closed.webp", open: "assets/station_open.webp",
    doorL: "assets/door_left.png", doorR: "assets/door_right.png", tracks: "assets/tracks.webp",
  };
  let assetsPromise = null;
  function loadAssets() {
    if (!assetsPromise) {
      assetsPromise = Promise.all(Object.entries(ASSET_SRC).map(([k, src]) => loadImage(src).then((img) => [k, img])))
        .then((pairs) => Object.fromEntries(pairs));
    }
    return assetsPromise;
  }
  loadAssets().catch(() => {});   // warm the cache while the form is filled in

  // ------------------------------------------------------------------ DOM
  const $ = (id) => document.getElementById(id);
  const intake = $("intake"), journey = $("journey");
  const form = $("intake-form"), collegeInput = $("college"), targetInput = $("target"), collegeError = $("college-error");
  const zoomer = $("zoomer"), stationCanvas = $("station"), sctx = stationCanvas.getContext("2d");
  const ticket = $("ticket"), flash = $("flash"), tracksCanvas = $("tracks");

  $("cc-list").innerHTML = Object.keys(COLLEGES).map((c) => `<option value="${c}"></option>`).join("");
  $("uni-list").innerHTML = UNIVERSITIES.map((u) => `<option value="${u}"></option>`).join("");

  // ------------------------------------------------------------------ ticket
  function fillTicket(college, target) {
    const now = new Date();
    const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, "0"), d = String(now.getDate()).padStart(2, "0");
    $("t-from").textContent = college;
    $("t-to").textContent = "?";            // the destination stays open on the ticket
    $("t-city").textContent = COLLEGES[college] || "";
    $("t-valid").textContent = `${y}年${m}月${d}日から2日間有効`;
    $("t-date").innerHTML = `${y}.${m}.${d}<br>60023-01`;
    $("t-no").textContent = "No. " + String(10000 + Math.floor(Math.random() * 89999));
    ticket.setAttribute("aria-label", `Train ticket from ${college}, destination open`);
    ticket.classList.remove("punched");
  }

  // shrink a single-line field until it fits its box (ticket fields are fixed-size)
  function fitText(el, max, min) {
    let size = max;
    el.style.fontSize = size + "px";
    while (el.scrollWidth > el.clientWidth && size > min) {
      size -= 1;
      el.style.fontSize = size + "px";
    }
  }

  // on narrow (portrait) screens only the middle of the stage is visible: keep the ticket inside it
  function ticketRest() {
    const s0 = Math.max(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
    const visibleW = window.innerWidth / s0;
    const fit = Math.min(1, (visibleW * 0.9) / 470);
    return visibleW < 1150 ? { x: STAGE_W / 2, y: TICKET_REST.y, rot: TICKET_REST.rot, fit } : { ...TICKET_REST, fit };
  }

  function placeTicket(t) {
    const REST = ticketRest();
    let x, y, rot, rx = 0, s = 1, op = 1;
    if (t < T.ticketIn[0]) { op = 0; x = 1650; y = -300; rot = 30; }
    else if (t < T.ticketIn[1]) {
      const u = prog(t, T.ticketIn), p = easeOutCubic(u);
      x = lerp(1650, REST.x, p);
      y = lerp(-300, REST.y, p) - Math.sin(u * Math.PI) * 120;
      rot = REST.rot + 36 * (1 - p) + 7 * Math.sin(u * 15) * Math.pow(1 - u, 2);
      rx = 55 * (1 - p);
      s = lerp(0.65, 1, p);
      op = clamp(u / 0.15, 0, 1);
    } else if (t < T.ticketToDoor[0]) {
      x = REST.x;
      y = REST.y + Math.sin((t - T.ticketIn[1]) * 1.6) * 4;
      rot = REST.rot + Math.sin((t - T.ticketIn[1]) * 1.1) * 0.7;
    } else {
      const u = prog(t, T.ticketToDoor), p = easeInOutCubic(u);
      x = lerp(REST.x, DOOR_FOCUS.x, p);
      y = lerp(REST.y, DOOR_FOCUS.y - 20, p) - Math.sin(u * Math.PI) * 90;
      rot = lerp(REST.rot, 0, p);
      s = lerp(1, 0.08, p);
      op = 1 - clamp((u - 0.6) / 0.4, 0, 1);
    }
    ticket.style.transform =
      `translate(${x - 235}px, ${y - 165}px) perspective(900px) rotateX(${rx}deg) rotate(${rot}deg) scale(${s * REST.fit})`;
    ticket.style.opacity = op;
    if (t >= T.punch && !ticket.classList.contains("punched")) ticket.classList.add("punched");
  }

  // ------------------------------------------------------------------ station canvas
  let A = null;                           // loaded images
  let closedImg, openImg, stripImg;       // copies with the destination sign painted in

  function drawSign(ctx, x, y, text) {
    ctx.save();
    ctx.fillStyle = "#0c0b10";
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, SIGN.w, SIGN.h, 3) : ctx.rect(x, y, SIGN.w, SIGN.h);
    ctx.fill();
    let size = 22;
    ctx.font = `700 ${size}px "Noto Sans JP", sans-serif`;
    while (ctx.measureText(text).width > SIGN.w - 10 && size > 11) {
      size -= 1;
      ctx.font = `700 ${size}px "Noto Sans JP", sans-serif`;
    }
    ctx.fillStyle = "#ffbe5c";
    ctx.shadowColor = "rgba(255, 170, 60, 0.9)";
    ctx.shadowBlur = 6;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(text, x + SIGN.w / 2, y + SIGN.h / 2 + 1);
    ctx.restore();
  }

  function withSign(img, target, dx = 0, dy = 0) {
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    if (target) drawSign(g, SIGN.x - dx, SIGN.y - dy, target);
    return c;
  }

  function drawTrain(ctx, offset, velocity) {
    const shutter = 1 / 30;
    const taps = reduceMotion ? 1 : clamp(Math.round(Math.abs(velocity) * shutter / 10), 1, 8);
    for (let i = 0; i < taps; i++) {
      const o = offset + (taps > 1 ? velocity * shutter * (i / (taps - 1) - 0.5) : 0);
      ctx.globalAlpha = 1 / (i + 1);
      const jitter = Math.abs(velocity) > 5 ? Math.sin(performance.now() / 23) * 0.6 : 0;
      for (let k = -1; k < 8; k++) {
        const x = SEG_X0 + o + k * SEG_W;
        if (x > STAGE_W || x + SEG_W < 0) continue;
        ctx.drawImage(stripImg, x, STRIP_TOP + jitter);
      }
      // the leading end of the train: a dark gangway so the cut edge reads as a car end
      const xf = SEG_X0 + o - SEG_W;
      if (xf > -30 && xf < STAGE_W) {
        const g = ctx.createLinearGradient(xf - 16, 0, xf + 4, 0);
        g.addColorStop(0, "rgba(10,10,14,0)");
        g.addColorStop(0.35, "#141418");
        g.addColorStop(1, "#2b2b31");
        ctx.fillStyle = g;
        ctx.fillRect(xf - 16, 342 + jitter, 20, 544);
      }
    }
    ctx.globalAlpha = 1;
  }

  function trainOffset(t) {
    if (reduceMotion) return { o: 0, v: 0 };
    const D = T.train[1] - T.train[0];
    const u = prog(t, T.train);
    const o = TRAIN_START_OFFSET * Math.pow(1 - u, 3);
    const v = u > 0 && u < 1 ? (-3 * TRAIN_START_OFFSET * Math.pow(1 - u, 2)) / D : 0;
    return { o, v };
  }

  function drawStation(t) {
    const ctx = sctx;
    ctx.clearRect(0, 0, STAGE_W, STAGE_H);
    if (t < T.settle[1]) {
      ctx.drawImage(A.bg, 0, 0);
      if (t >= T.train[0]) {
        if (reduceMotion) {
          ctx.globalAlpha = prog(t, T.train);
          ctx.drawImage(closedImg, 0, 0);
          ctx.globalAlpha = 1;
        } else {
          const { o, v } = trainOffset(t);
          drawTrain(ctx, o, v);
        }
      }
      ctx.drawImage(A.fg, 0, 0);
      if (t >= T.settle[0]) {
        ctx.globalAlpha = prog(t, T.settle);
        ctx.drawImage(closedImg, 0, 0);
        ctx.globalAlpha = 1;
      }
    } else if (t < T.doors[0]) {
      ctx.drawImage(closedImg, 0, 0);
    } else {
      ctx.drawImage(openImg, 0, 0);
      const u = prog(t, T.doors);
      const dx = (DOOR.split - DOOR.x) * easeInOutCubic(u);
      ctx.save();
      ctx.beginPath();
      ctx.rect(DOOR.x, DOOR.y, DOOR.w, DOOR.h);
      ctx.clip();
      ctx.drawImage(A.doorL, DOOR.x - dx, DOOR.y);
      ctx.drawImage(A.doorR, DOOR.split + dx, DOOR.y);
      ctx.restore();
    }
    const fade = 1 - prog(t, T.fadeIn);
    if (fade > 0) {
      ctx.fillStyle = `rgba(0,0,0,${fade})`;
      ctx.fillRect(0, 0, STAGE_W, STAGE_H);
    }
  }

  function placeStage(t) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const s0 = Math.max(vw / STAGE_W, vh / STAGE_H);
    const u = prog(t, T.zoom);
    let z = 1, fx = STAGE_W / 2, fy = STAGE_H / 2;
    if (!reduceMotion && u > 0) {
      z = Math.exp(Math.log(11) * easeInCubic(u));
      const p = easeInOutCubic(clamp(u * 1.6, 0, 1));
      fx = lerp(STAGE_W / 2, DOOR_FOCUS.x, p);
      fy = lerp(STAGE_H / 2, DOOR_FOCUS.y, p);
    }
    const s = s0 * z;
    zoomer.style.transform = `translate(${vw / 2 - fx * s}px, ${vh / 2 - fy * s}px) scale(${s})`;
  }

  // ------------------------------------------------------------------ track ride (WebGL)
  let gl = null, glProg = null, glUniforms = {}, glReady = false;

  const VERT = `
    attribute vec2 aPos;
    void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;
  const FRAG = `
    precision highp float;
    uniform sampler2D uTex;
    uniform vec2 uRes, uImg, uVP;
    uniform float uT, uBlur, uFloorK, uWallK, uWarm, uLat, uPan, uFade, uZoom;
    // inverse depth: ground plane below the horizon, the platform/station wall on the right
    float depthAt(vec2 p) {
      float iF = max(p.y - uVP.y, 0.0) / uFloorK;
      float iW = max(p.x - uVP.x, 0.0) / uWallK * smoothstep(1040.0, 1180.0, p.x);
      return 1.0 / max(max(iF, iW), 1e-5);
    }
    void main() {
      vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
      float sc = max(uRes.x / uImg.x, uRes.y / uImg.y);
      vec2 p = (frag - uRes * 0.5) / sc + uImg * 0.5;
      p = uImg * 0.5 + (p - uImg * 0.5) / uZoom;   // slight zoom-in keeps the frame edges inside the photo
      p.x += uPan;                                   // camera yaw while following the branch
      float z = depthAt(p);
      vec3 acc = vec3(0.0);
      for (int i = 0; i < 12; i++) {
        float tt = max(uT - uBlur * float(i) / 11.0, 0.0);
        // forward travel tt plus a sideways move uLat: near ground shifts a lot, the horizon barely moves
        vec2 src = uVP + vec2((p.x - uVP.x) * z + uLat, (p.y - uVP.y) * z) / (z + tt);
        acc += texture2D(uTex, clamp(src / uImg, 0.0, 1.0)).rgb;
      }
      vec3 col = acc / 12.0;
      vec2 q = frag / uRes - 0.5;
      col *= mix(0.72, 1.0, smoothstep(0.85, 0.25, length(q * vec2(1.1, 1.0))));
      col = mix(col, col * vec3(1.06, 0.98, 0.9), uWarm);
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(lum) * vec3(1.0, 0.85, 0.75), uFade * 0.6);
      col = mix(col, vec3(0.025, 0.02, 0.035), smoothstep(0.0, 1.0, uFade));
      gl_FragColor = vec4(col, 1.0);
    }`;

  function initGL() {
    gl = tracksCanvas.getContext("webgl", { antialias: false, preserveDrawingBuffer: true });
    if (!gl) return false;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    glProg = gl.createProgram();
    gl.attachShader(glProg, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(glProg, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(glProg);
    gl.useProgram(glProg);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(glProg, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, A.tracks);
    for (const n of ["uRes", "uImg", "uVP", "uT", "uBlur", "uFloorK", "uWallK", "uWarm", "uLat", "uPan", "uFade", "uZoom"]) glUniforms[n] = gl.getUniformLocation(glProg, n);
    gl.uniform2f(glUniforms.uImg, TRACK_IMG.w, TRACK_IMG.h);
    gl.uniform2f(glUniforms.uVP, TRACK_VP.x, TRACK_VP.y);
    gl.uniform1f(glUniforms.uFloorK, 250.0);
    gl.uniform1f(glUniforms.uWallK, 1500.0);
    return true;
  }

  function rideTravel(t) {
    const u = prog(t, T.ride);
    const maxT = reduceMotion ? 0.1 : 1.1;
    // ease in, then keep rolling at a steady pace to the end (no stop)
    return maxT * (u < 0.25 ? 2 * u * u : u - 0.125) / 0.875;
  }

  // sideways drift onto the chosen branch and a slight turn to follow it
  function rideSteer(t) {
    const p = reduceMotion ? 0 : easeInOutSine(prog(t, T.steer));
    return { lat: ROUTE * 320 * p, pan: ROUTE * 30 * p, zoom: 1 + 0.28 * p };
  }

  function drawTracks(t) {
    if (!glReady) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(window.innerWidth * dpr), h = Math.round(window.innerHeight * dpr);
    if (tracksCanvas.width !== w || tracksCanvas.height !== h) { tracksCanvas.width = w; tracksCanvas.height = h; }
    gl.viewport(0, 0, w, h);
    const travel = rideTravel(t);
    const speed = (rideTravel(t + 1 / 60) - travel) * 60;
    gl.uniform2f(glUniforms.uRes, w, h);
    gl.uniform1f(glUniforms.uT, travel);
    gl.uniform1f(glUniforms.uBlur, reduceMotion ? 0 : clamp(speed * 0.15, 0, 0.03));
    gl.uniform1f(glUniforms.uWarm, 0.4);
    const steer = rideSteer(t);
    gl.uniform1f(glUniforms.uLat, steer.lat);
    gl.uniform1f(glUniforms.uPan, steer.pan);
    gl.uniform1f(glUniforms.uZoom, steer.zoom);
    gl.uniform1f(glUniforms.uFade, prog(t, T.fadeOut));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // ------------------------------------------------------------------ main loop
  let startTime = 0, rafId = 0, state = null, handedOff = false;

  function frame(now) {
    const t = (now - startTime) / 1000;
    if (t < T.zoom[1]) {
      zoomer.style.visibility = "visible";
      placeStage(t);
      drawStation(t);
      placeTicket(t);
    } else {
      zoomer.style.visibility = "hidden";
    }
    flash.style.opacity = t < T.ride[0] ? prog(t, T.flashIn) : 1 - prog(t, T.flashOut);
    if (t >= T.ride[0]) {
      tracksCanvas.style.opacity = glReady ? 1 : 0;
      drawTracks(t);
    } else {
      tracksCanvas.style.opacity = 0;
    }
    if (t < END) rafId = requestAnimationFrame(frame);
    else goToNextPage();
  }

  // After the fade to black, continue to the next page (set data-next on <body>), passing what the
  // student entered both in the URL and in sessionStorage.
  function goToNextPage() {
    if (handedOff) return;
    handedOff = true;
    const next = new URL(document.body.dataset.next || "plan.html", window.location.href);
    if (next.origin !== window.location.origin) return;     // only same-site pages
    next.searchParams.set("college", state.college);
    if (state.target) next.searchParams.set("target", state.target);
    try { sessionStorage.setItem("sepath.journey", JSON.stringify(state)); } catch (e) { /* storage blocked */ }
    window.location.assign(next.href);
  }

  function play(fromTime = 0) {
    cancelAnimationFrame(rafId);
    handedOff = false;
    ticket.classList.remove("punched");
    startTime = performance.now() - fromTime * 1000;
    rafId = requestAnimationFrame(frame);
  }

  async function startJourney(college, target) {
    state = { college, target };
    fillTicket(college, target);
    intake.classList.remove("is-active");
    journey.classList.add("is-active");
    try {
      A = await loadAssets();
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
    } catch (err) {
      console.error(err);
      return;
    }
    fitText($("t-from"), 29, 16);
    const signText = target || "University";
    closedImg = withSign(A.closed, signText);
    openImg = withSign(A.open, signText);
    stripImg = withSign(A.strip, signText, SEG_X0, STRIP_TOP);
    if (!gl) {
      try { glReady = initGL(); } catch (err) { console.error(err); glReady = false; }
    }
    play(0);
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const college = collegeInput.value.trim();
    if (!college) {
      collegeInput.setAttribute("aria-invalid", "true");
      collegeError.hidden = false;
      collegeInput.focus();
      return;
    }
    collegeInput.removeAttribute("aria-invalid");
    collegeError.hidden = true;
    startJourney(college, targetInput.value.trim());
  });

  // skipping still ends with the short fade so the hand-off never jumps
  $("skip").addEventListener("click", () => play(Math.max(T.fadeOut[1] - 1.0, 0)));
  window.addEventListener("resize", () => {
    if (!journey.classList.contains("is-active") || !A) return;
    const t = (performance.now() - startTime) / 1000;
    if (t >= END) { if (t >= T.ride[0]) drawTracks(END); else placeStage(t); }
  });

  // expose for automated checks: render a specific moment without waiting
  window.__journey = { T, END, seek: (t) => play(t), hold: () => { handedOff = true; } };
})();
