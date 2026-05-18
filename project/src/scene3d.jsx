/* ============================================================
   BRAINWORK ROYALE — 3D SCENE ENGINE (Three.js + PEP-Smol)
   Renders maze + PEP-Smol agents in a top-down-angled 3D view.
   Each agent is a cloned, tinted GLTF with its own AnimationMixer.
   State (idle / run / attack / hit / death) is mapped to clips
   with physics-smooth crossfade. OrbitControls give the user
   damped 360° rotation + zoom.
   ============================================================ */

const CELL = 1.0;

function parseColor(str) {
  if (typeof str === "string" && str.startsWith("#")) return new THREE.Color(str);
  try {
    const el = document.createElement("div");
    el.style.color = str;
    document.body.appendChild(el);
    const rgb = getComputedStyle(el).color;
    document.body.removeChild(el);
    if (rgb && rgb.startsWith("rgb")) return new THREE.Color(rgb);
  } catch (e) {}
  return new THREE.Color(0x5df2d6);
}

// PEP-Smol material name → role.  We tint body parts to the agent's color
// and leave the head as-is.
function tintMaterial(matName, baseColor, tintColor) {
  const c = baseColor.clone();
  if (!matName) return c;
  if (/hip|belly|chest|arm|forearm|leg|thigh|foot/i.test(matName)) {
    // multiply tint over base color so texture/emissive detail is preserved
    c.multiply(tintColor).lerp(tintColor, 0.55);
  }
  return c;
}

function createScene3D(container) {
  // ---- renderer / scene / camera ----
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060c);
  scene.fog = new THREE.Fog(0x05060c, 18, 44);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";

  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 200);

  function resize() {
    const r = container.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  // ---- OrbitControls (damped — physics-feel rotate + zoom) ----
  let controls = null;
  if (window.OrbitControls) {
    controls = new window.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.85;
    controls.zoomSpeed = 0.9;
    controls.minDistance = 5;
    controls.maxDistance = 36;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minPolarAngle = Math.PI * 0.10;
    controls.enablePan = false;
  }

  // ---- Lights ----
  scene.add(new THREE.AmbientLight(0x3a4060, 0.55));

  const sun = new THREE.DirectionalLight(0xfff2dc, 1.1);
  sun.position.set(8, 18, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -22;
  sun.shadow.camera.right = 22;
  sun.shadow.camera.top = 22;
  sun.shadow.camera.bottom = -22;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);

  const accentA = new THREE.PointLight(0x5df2d6, 1.5, 20);
  accentA.position.set(2, 4, 2);
  scene.add(accentA);
  const accentB = new THREE.PointLight(0xff4d9d, 1.0, 20);
  accentB.position.set(18, 4, 12);
  scene.add(accentB);

  // ---- State ----
  let agentVisuals = [];
  let mazeMeshes = [];
  let floorMesh = null;
  let gridHelper = null;
  let treasureGroup = null;
  let currentReplay = null;
  let elapsed = 0;

  // ---- Particle pool (sparks on hit / KO) ----
  const particles = [];
  const sparkGeo = new THREE.SphereGeometry(0.05, 6, 6);

  function spawnSparks(x, y, z, count, colorHex, life = 0.6) {
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: colorHex, transparent: true, opacity: 0.95,
      });
      const m = new THREE.Mesh(sparkGeo, mat);
      m.position.set(x, y, z);
      const ang = Math.random() * Math.PI * 2;
      const horiz = 0.4 + Math.random() * 1.4;
      const up = 1.0 + Math.random() * 1.8;
      particles.push({
        mesh: m,
        vx: Math.cos(ang) * horiz,
        vy: up,
        vz: Math.sin(ang) * horiz,
        life: 0, maxLife: life * (0.7 + Math.random() * 0.5),
        scale0: 0.8 + Math.random() * 0.6,
      });
      scene.add(m);
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        scene.remove(p.mesh);
        p.mesh.material.dispose();
        particles.splice(i, 1);
        continue;
      }
      const t = p.life / p.maxLife;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.vy -= 6.5 * dt; // gravity
      p.mesh.material.opacity = 0.95 * (1 - t);
      const s = p.scale0 * (1 - t * 0.5);
      p.mesh.scale.set(s, s, s);
    }
  }

  // Pre-compute PEP base normalization (height + ground-offset) ONCE
  let pepBaseInfo = null;
  function getPepBaseInfo() {
    if (pepBaseInfo) return pepBaseInfo;
    if (!window.PEP_BASE) return null;
    const tmp = window.PEP_BASE.scene.clone(true);
    const box = new THREE.Box3().setFromObject(tmp);
    const size = new THREE.Vector3(); box.getSize(size);
    const targetH = 1.4; // a bit taller than walls so agents read clearly
    const scale = targetH / Math.max(size.y, 0.1);
    // After scaling, ground offset = -box.min.y * scale
    const groundOffset = -box.min.y * scale;
    // Center offset
    const cx = (box.min.x + box.max.x) / 2 * scale;
    const cz = (box.min.z + box.max.z) / 2 * scale;
    pepBaseInfo = { scale, groundOffset, cx, cz };
    return pepBaseInfo;
  }

  function disposeNode(n) {
    n.traverse?.((c) => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        const ms = Array.isArray(c.material) ? c.material : [c.material];
        ms.forEach((m) => {
          if (m.map && m._om_cloned) m.map.dispose();
          m.dispose();
        });
      }
    });
  }

  function buildMaze(maze) {
    mazeMeshes.forEach((m) => { scene.remove(m); disposeNode(m); });
    mazeMeshes = [];
    if (floorMesh) { scene.remove(floorMesh); disposeNode(floorMesh); floorMesh = null; }
    if (gridHelper) { scene.remove(gridHelper); gridHelper.geometry.dispose(); gridHelper.material.dispose(); gridHelper = null; }
    if (treasureGroup) { scene.remove(treasureGroup); disposeNode(treasureGroup); treasureGroup = null; }

    const { grid, cols, rows, treasure } = maze;

    const floorGeo = new THREE.PlaneGeometry(cols * CELL + 4, rows * CELL + 4);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x0a0d1c, roughness: 0.95, metalness: 0.05,
    });
    floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.set((cols - 1) * CELL / 2, 0, (rows - 1) * CELL / 2);
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);

    gridHelper = new THREE.GridHelper(Math.max(cols, rows) * CELL, Math.max(cols, rows), 0x1f2a48, 0x1a2238);
    gridHelper.position.set((cols - 1) * CELL / 2, 0.01, (rows - 1) * CELL / 2);
    scene.add(gridHelper);

    let wallCount = 0;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++)
        if (grid[y][x] === 1) wallCount++;

    const wallGeo = new THREE.BoxGeometry(CELL * 0.98, CELL * 1.1, CELL * 0.98);
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x1d2747, emissive: 0x5df2d6, emissiveIntensity: 0.08,
      roughness: 0.55, metalness: 0.25,
    });
    const wallMesh = new THREE.InstancedMesh(wallGeo, wallMat, wallCount);
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;
    const m4 = new THREE.Matrix4();
    let idx = 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (grid[y][x] === 1) {
          m4.makeTranslation(x * CELL, CELL * 0.55, y * CELL);
          wallMesh.setMatrixAt(idx++, m4);
        }
      }
    }
    wallMesh.instanceMatrix.needsUpdate = true;
    scene.add(wallMesh);
    mazeMeshes.push(wallMesh);

    const topGeo = new THREE.BoxGeometry(CELL * 1.0, 0.05, CELL * 1.0);
    const topMat = new THREE.MeshBasicMaterial({ color: 0x9bf0e0 });
    const topMesh = new THREE.InstancedMesh(topGeo, topMat, wallCount);
    idx = 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (grid[y][x] === 1) {
          m4.makeTranslation(x * CELL, CELL * 1.1, y * CELL);
          topMesh.setMatrixAt(idx++, m4);
        }
      }
    }
    topMesh.instanceMatrix.needsUpdate = true;
    scene.add(topMesh);
    mazeMeshes.push(topMesh);

    // ---- Obstacles ----
    // Per-type tile geometry sits flush on the floor. We dispose with
    // the rest of the maze on the next setReplay().
    const obs = maze.obstacles;
    if (obs) {
      // Pre-allocate per-type material so all tiles share one
      const obstacleMats = {
        spike: new THREE.MeshStandardMaterial({
          color: 0x401015, emissive: 0xff3355, emissiveIntensity: 0.9,
          roughness: 0.6, metalness: 0.3,
        }),
        speed: new THREE.MeshStandardMaterial({
          color: 0x103a3a, emissive: 0x5df2d6, emissiveIntensity: 0.7,
          roughness: 0.5, metalness: 0.3,
        }),
        slow: new THREE.MeshStandardMaterial({
          color: 0x10203a, emissive: 0x4488ff, emissiveIntensity: 0.4,
          roughness: 0.85, metalness: 0.1, transparent: true, opacity: 0.85,
        }),
        jump: new THREE.MeshStandardMaterial({
          color: 0x3a2a10, emissive: 0xffb84d, emissiveIntensity: 0.7,
          roughness: 0.5, metalness: 0.3,
        }),
        hurdle: new THREE.MeshStandardMaterial({
          color: 0x35304d, emissive: 0xfff066, emissiveIntensity: 0.5,
          roughness: 0.4, metalness: 0.4,
        }),
      };
      const tileGeo = new THREE.BoxGeometry(CELL * 0.85, 0.06, CELL * 0.85);
      const spikeGeo = new THREE.ConeGeometry(0.08, 0.22, 5);
      const arrowGeo = new THREE.BoxGeometry(CELL * 0.18, 0.04, CELL * 0.55);

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const o = obs[y][x];
          if (!o) continue;
          const mat = obstacleMats[o.type];
          if (!mat) continue;
          const tile = new THREE.Mesh(tileGeo, mat);
          tile.position.set(x * CELL, 0.04, y * CELL);
          tile.receiveShadow = true;
          scene.add(tile);
          mazeMeshes.push(tile);

          // Per-type decoration on top of the tile
          if (o.type === "spike") {
            // Four small spikes
            for (let i = 0; i < 4; i++) {
              const spike = new THREE.Mesh(spikeGeo, mat);
              const ang = (i / 4) * Math.PI * 2;
              spike.position.set(x * CELL + Math.cos(ang) * 0.18, 0.16, y * CELL + Math.sin(ang) * 0.18);
              spike.castShadow = true;
              scene.add(spike);
              mazeMeshes.push(spike);
            }
          } else if (o.type === "speed") {
            // Arrow pointing in a random direction (decorative)
            const arrow = new THREE.Mesh(arrowGeo, mat);
            arrow.position.set(x * CELL, 0.09, y * CELL);
            arrow.rotation.y = (((x * 7 + y * 13) % 4) * Math.PI) / 2;
            scene.add(arrow);
            mazeMeshes.push(arrow);
          } else if (o.type === "jump") {
            // Plus-shaped pad
            const a1 = new THREE.Mesh(arrowGeo, mat);
            a1.position.set(x * CELL, 0.09, y * CELL);
            scene.add(a1);
            const a2 = new THREE.Mesh(arrowGeo, mat);
            a2.position.set(x * CELL, 0.09, y * CELL);
            a2.rotation.y = Math.PI / 2;
            scene.add(a2);
            mazeMeshes.push(a1, a2);
          } else if (o.type === "hurdle") {
            // Two short posts + a horizontal bar — classic race hurdle.
            // Bar is rotated to span perpendicular to the corridor's long axis
            // (rows > cols ⇒ corridor runs along Z, so bar spans X).
            const postGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.38, 8);
            const barGeo = new THREE.BoxGeometry(CELL * 0.85, 0.04, 0.04);
            const isRace = (rows > cols);  // race tracks are tall + narrow
            const post1 = new THREE.Mesh(postGeo, mat);
            const post2 = new THREE.Mesh(postGeo, mat);
            const bar = new THREE.Mesh(barGeo, mat);
            if (isRace) {
              post1.position.set(x * CELL - 0.38, 0.19, y * CELL);
              post2.position.set(x * CELL + 0.38, 0.19, y * CELL);
              bar.position.set(x * CELL, 0.38, y * CELL);
            } else {
              post1.position.set(x * CELL, 0.19, y * CELL - 0.38);
              post2.position.set(x * CELL, 0.19, y * CELL + 0.38);
              bar.position.set(x * CELL, 0.38, y * CELL);
              bar.rotation.y = Math.PI / 2;
            }
            [post1, post2, bar].forEach((m) => { m.castShadow = true; scene.add(m); mazeMeshes.push(m); });
          }
        }
      }
    }

    // ---- Race-mode props: starting blocks at the bottom + finish banner at top ----
    if (maze.isRace) {
      const startMat = new THREE.MeshStandardMaterial({
        color: 0x10203a, emissive: 0x5df2d6, emissiveIntensity: 0.5,
        roughness: 0.5, metalness: 0.4,
      });
      // Starting blocks across the spawn row
      const startY = rows - 2;
      for (let x = 1; x < cols - 1; x++) {
        const block = new THREE.Mesh(
          new THREE.BoxGeometry(CELL * 0.6, 0.08, CELL * 0.18),
          startMat
        );
        block.position.set(x * CELL, 0.05, startY * CELL + 0.35);
        block.receiveShadow = true;
        scene.add(block); mazeMeshes.push(block);
      }
      // Finish-line banner at the top
      const bannerMat = new THREE.MeshStandardMaterial({
        color: 0xffb84d, emissive: 0xfff066, emissiveIntensity: 1.0,
        roughness: 0.3, metalness: 0.4,
      });
      const pole1 = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 8), bannerMat);
      const pole2 = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 8), bannerMat);
      const banner = new THREE.Mesh(
        new THREE.BoxGeometry((cols - 2) * CELL, 0.18, 0.05),
        bannerMat
      );
      pole1.position.set(CELL, 0.8, CELL);
      pole2.position.set((cols - 2) * CELL, 0.8, CELL);
      banner.position.set((cols - 1) * CELL / 2, 1.5, CELL);
      [pole1, pole2, banner].forEach((m) => { m.castShadow = true; scene.add(m); mazeMeshes.push(m); });
    }

    // Treasure
    treasureGroup = new THREE.Group();
    const dGeo = new THREE.OctahedronGeometry(0.32, 0);
    const dMat = new THREE.MeshStandardMaterial({
      color: 0xffb84d, emissive: 0xffa030, emissiveIntensity: 0.9,
      roughness: 0.2, metalness: 0.8,
    });
    const diamond = new THREE.Mesh(dGeo, dMat);
    diamond.position.y = 0.65;
    diamond.castShadow = true;
    treasureGroup.add(diamond);

    const pedGeo = new THREE.CylinderGeometry(0.35, 0.4, 0.15, 12);
    const pedMat = new THREE.MeshStandardMaterial({
      color: 0x35304d, emissive: 0xffb84d, emissiveIntensity: 0.15, roughness: 0.6,
    });
    const ped = new THREE.Mesh(pedGeo, pedMat);
    ped.position.y = 0.08;
    ped.receiveShadow = true;
    treasureGroup.add(ped);

    const ringGeo = new THREE.RingGeometry(0.5, 0.85, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffb84d, transparent: true, opacity: 0.45, side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    treasureGroup.add(ring);

    const tlight = new THREE.PointLight(0xffb84d, 2.0, 7);
    tlight.position.y = 0.9;
    treasureGroup.add(tlight);

    treasureGroup.position.set(treasure[0] * CELL, 0, treasure[1] * CELL);
    treasureGroup.userData = { diamond, ring, tlight };
    scene.add(treasureGroup);

    // Camera framing — Boomerang-Fu top-down-angled
    const cx = (cols - 1) * CELL / 2;
    const cz = (rows - 1) * CELL / 2;
    const dist = Math.max(cols, rows) * 0.9;
    camera.position.set(cx, dist * 0.85, cz + dist * 0.62);
    camera.lookAt(cx, 0, cz);
    if (controls) {
      controls.target.set(cx, 0.5, cz);
      controls.update();
    }
  }

  // ============================================================
  // PEP-SMOL AGENT — cloned, tinted, animated
  // ============================================================
  function makePepAgent(colorStr, isYou) {
    const wrapper = new THREE.Group();
    const tintColor = parseColor(colorStr);

    let model = null;
    let mixer = null;
    let actions = {};

    if (window.PEP_BASE && !window.PEP_FAILED) {
      const info = getPepBaseInfo();
      model = window.PEP_BASE.scene.clone(true);
      model.scale.setScalar(info.scale);
      model.position.y = info.groundOffset;
      model.position.x = -info.cx;
      model.position.z = -info.cz;

      model.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          // clone materials per-agent so tint doesn't leak
          if (o.material) {
            const isArr = Array.isArray(o.material);
            const list = isArr ? o.material : [o.material];
            const next = list.map((m) => {
              const cm = m.clone();
              cm._om_cloned = true;
              if (cm.color) {
                cm.color.copy(tintMaterial(cm.name, cm.color, tintColor));
              }
              if (cm.emissive) {
                // dim emissive so colors read cleanly
                cm.emissiveIntensity = Math.min(cm.emissiveIntensity ?? 1, 0.5);
              }
              return cm;
            });
            o.material = isArr ? next : next[0];
          }
        }
      });

      wrapper.add(model);

      mixer = new THREE.AnimationMixer(model);
      window.PEP_BASE.animations.forEach((clip) => {
        actions[clip.name] = mixer.clipAction(clip);
      });
    } else {
      // Fallback: a simple capsule so things still render if PEP failed to load
      const fallback = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.18, 0.4, 4, 8),
        new THREE.MeshStandardMaterial({ color: tintColor, roughness: 0.6 })
      );
      fallback.position.y = 0.45;
      fallback.castShadow = true;
      wrapper.add(fallback);
    }

    // YOU ring on the floor
    let youRing = null;
    if (isYou) {
      const ringGeo = new THREE.RingGeometry(0.34, 0.44, 28);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x5df2d6, transparent: true, opacity: 0.7, side: THREE.DoubleSide,
      });
      youRing = new THREE.Mesh(ringGeo, ringMat);
      youRing.rotation.x = -Math.PI / 2;
      youRing.position.y = 0.02;
      wrapper.add(youRing);
    }

    // HP bar sprite
    const hpCanvas = document.createElement("canvas");
    hpCanvas.width = 80; hpCanvas.height = 16;
    const hpTex = new THREE.CanvasTexture(hpCanvas);
    hpTex.minFilter = THREE.LinearFilter;
    const hpSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: hpTex, depthTest: false, depthWrite: false,
    }));
    hpSprite.position.y = 1.7;
    hpSprite.scale.set(0.75, 0.15, 1);
    wrapper.add(hpSprite);

    return {
      group: wrapper, model, mixer, actions,
      currentName: null, currentAction: null,
      hpCanvas, hpTex, hpSprite, youRing,
      tintColor,
      curX: 0, curZ: 0, facing: 0, alive: true,
      _attackUntilTick: -1,
      _hitUntilTick: -1,
      // Physics-feel state — knockback offset that decays per frame
      knockX: 0, knockZ: 0,
      // Track which jump and hit events we've already reacted to so
      // we don't re-spawn sparks every frame inside the trigger window.
      _lastJumpFromTick: -1,
      _lastHitVfxTick: -1,
      _wasAlive: true,
    };
  }

  function playClip(agent, name, fadeMs = 240, loop = true, speed = 1) {
    if (!agent.mixer) return;
    const next = agent.actions[name];
    if (!next) return;
    if (agent.currentName === name) {
      next.setEffectiveTimeScale(speed);
      return;
    }
    next.reset();
    if (!loop) {
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true;
    } else {
      next.setLoop(THREE.LoopRepeat, Infinity);
      next.clampWhenFinished = false;
    }
    next.setEffectiveWeight(1);
    next.setEffectiveTimeScale(speed);
    next.play();
    if (agent.currentAction && agent.currentAction !== next) {
      agent.currentAction.crossFadeTo(next, fadeMs / 1000, false);
    }
    agent.currentAction = next;
    agent.currentName = name;
  }

  function updateHpBar(v, hp, maxHp) {
    const c = v.hpCanvas;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = "#1a1d2e";
    ctx.fillRect(0, 5, c.width, 6);
    const pct = Math.max(0, Math.min(1, hp / maxHp));
    ctx.fillStyle = pct > 0.5 ? "#7be38a" : pct > 0.25 ? "#ffb84d" : "#ff5577";
    ctx.fillRect(1, 6, (c.width - 2) * pct, 4);
    v.hpTex.needsUpdate = true;
  }

  function setReplay(replay) {
    agentVisuals.forEach((v) => { scene.remove(v.group); disposeNode(v.group); });
    agentVisuals = [];
    // Clear leftover particles from the previous match
    particles.forEach((p) => { scene.remove(p.mesh); p.mesh.material.dispose(); });
    particles.length = 0;

    currentReplay = replay;
    buildMaze({ grid: replay.maze.grid, cols: replay.cols, rows: replay.rows, treasure: replay.treasure });

    replay.agents.forEach((a) => {
      const v = makePepAgent(a.color, a.isYou);
      scene.add(v.group);
      agentVisuals.push(v);
    });

    const snap0 = replay.snaps[0];
    snap0.forEach((s, i) => {
      const v = agentVisuals[i];
      v.curX = s.x * CELL; v.curZ = s.y * CELL;
      v.facing = s.facing || 0;
      v.alive = s.alive;
      v.group.position.set(v.curX, 0, v.curZ);
      v.group.rotation.y = v.facing;
      updateHpBar(v, s.hp, replay.agents[i].maxHp);
      playClip(v, "Idle 01", 0, true, 1);
    });
  }

  function renderFrame(dt, opts) {
    elapsed += dt;
    if (!currentReplay) {
      if (controls) controls.update();
      renderer.render(scene, camera);
      return;
    }
    const { tickIndex, fractional } = opts;
    const tc = Math.max(0, Math.min(tickIndex, currentReplay.snaps.length - 1));
    const tn = Math.min(tc + 1, currentReplay.snaps.length - 1);
    const cur = currentReplay.snaps[tc];
    const nxt = currentReplay.snaps[tn];

    currentReplay.agents.forEach((a, i) => {
      const v = agentVisuals[i];
      const sCur = cur[i], sNxt = nxt[i];

      // Position lerp (cell-to-cell)
      const fx = sCur.x * CELL, fz = sCur.y * CELL;
      const tx = sNxt.x * CELL, tz = sNxt.y * CELL;
      v.curX = fx + (tx - fx) * fractional;
      v.curZ = fz + (tz - fz) * fractional;

      // ---- Jump-pad parabolic arc ----
      // When the cell delta between snaps is > 1, the agent was teleported
      // by a jump pad in that tick. Render a parabolic Y so they visibly
      // leap. Peak height scales with jump distance.
      const cellDx = Math.abs(sNxt.x - sCur.x);
      const cellDy = Math.abs(sNxt.y - sCur.y);
      const cellDist = cellDx + cellDy;
      let arcY = 0;
      if (cellDist > 1 && sCur.alive && sNxt.alive) {
        const arcHeight = 0.55 + cellDist * 0.18;
        // f(t) = 4*h*t*(1-t) — parabola peaking at t=0.5
        arcY = 4 * arcHeight * fractional * (1 - fractional);
      }

      // ---- Knockback decay ----
      // Apply per-frame easing toward zero. ~250ms half-life.
      v.knockX *= Math.max(0, 1 - dt * 6);
      v.knockZ *= Math.max(0, 1 - dt * 6);

      v.group.position.x = v.curX + v.knockX;
      v.group.position.z = v.curZ + v.knockZ;
      v.group.position.y = arcY;

      // Death — clamp pose + clip + spark burst on the falling tick
      if (!sCur.alive) {
        v.group.position.y = 0;
        if (v.alive) {
          // freshly killed — death anim + dramatic burst
          playClip(v, "Death 01", 220, false, 1);
          spawnSparks(v.curX, 0.55, v.curZ, 14, 0xff4d6d, 0.85);
        }
        v.alive = false;
        v._wasAlive = false;
        v.hpSprite.visible = false;
        if (v.mixer) v.mixer.update(dt);
        return;
      }
      v.alive = true;
      v.hpSprite.visible = true;

      // Facing — physics-smooth turn
      const targetFacing = sNxt.facing || 0;
      const da = ((targetFacing - v.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      v.facing += da * Math.min(1, dt * 10);
      v.group.rotation.y = v.facing;

      // ---- State → clip mapping ----
      const justAttacked = (sNxt.lastAttackAt === tn) || (sCur.lastAttackAt === tc);
      const justHit = (sNxt.lastDamageAt === tn) || (sCur.lastDamageAt === tc);
      const moving = (sNxt.x !== sCur.x) || (sNxt.y !== sCur.y);

      if (justAttacked) v._attackUntilTick = tn + 1;
      if (justHit) v._hitUntilTick = tn;

      // ---- Hit VFX: knockback impulse + spark burst (fire once per hit) ----
      if (justHit) {
        const hitMarkerTick = sNxt.lastDamageAt;
        if (hitMarkerTick !== v._lastHitVfxTick) {
          v._lastHitVfxTick = hitMarkerTick;
          // Knockback in the direction the defender was facing (they faced
          // the attacker before the swing landed, so pushing back = -facing).
          const impulse = 0.22;
          v.knockX = -Math.sin(v.facing) * impulse;
          v.knockZ = -Math.cos(v.facing) * impulse;
          spawnSparks(v.curX, 0.65, v.curZ, 4, 0xff4d6d, 0.4);
        }
      }

      const attacking = tn <= v._attackUntilTick;
      const hitting = tn <= v._hitUntilTick;

      if (attacking) {
        playClip(v, "Attack 01", 90, false, 1.6);
      } else if (hitting) {
        playClip(v, "Get Hit 01", 80, false, 1.4);
      } else if (moving) {
        playClip(v, "Run 01", 200, true, 1.0);
      } else {
        playClip(v, "Idle 01", 280, true, 1.0);
      }

      // YOU ring pulse
      if (v.youRing) {
        v.youRing.material.opacity = 0.5 + Math.sin(elapsed * 4) * 0.2;
        v.youRing.scale.setScalar(1 + Math.sin(elapsed * 4) * 0.08);
      }

      // HP bar
      const hpInterp = sCur.hp + (sNxt.hp - sCur.hp) * fractional;
      updateHpBar(v, hpInterp, currentReplay.agents[i].maxHp);

      if (v.mixer) v.mixer.update(dt);
    });

    // Particle pool (sparks from hits, KOs, etc.)
    updateParticles(dt);

    // Treasure animation
    if (treasureGroup) {
      const { diamond, ring, tlight } = treasureGroup.userData;
      diamond.rotation.y = elapsed * 1.8;
      diamond.position.y = 0.65 + Math.sin(elapsed * 2) * 0.08;
      ring.scale.setScalar(1 + Math.sin(elapsed * 3) * 0.1);
      ring.material.opacity = 0.35 + Math.sin(elapsed * 3) * 0.15;
      tlight.intensity = 1.6 + Math.sin(elapsed * 5) * 0.7;
    }

    // Accent light drift
    accentA.position.x = 2 + Math.sin(elapsed * 0.5) * 1;
    accentB.position.z = 12 + Math.cos(elapsed * 0.4) * 1;

    if (controls) controls.update();
    renderer.render(scene, camera);
  }

  function dispose() {
    ro.disconnect();
    if (controls) controls.dispose();
    agentVisuals.forEach((v) => disposeNode(v.group));
    mazeMeshes.forEach(disposeNode);
    if (floorMesh) disposeNode(floorMesh);
    if (gridHelper) { gridHelper.geometry.dispose(); gridHelper.material.dispose(); }
    if (treasureGroup) disposeNode(treasureGroup);
    // Particle cleanup
    particles.forEach((p) => { scene.remove(p.mesh); p.mesh.material.dispose(); });
    particles.length = 0;
    sparkGeo.dispose();
    renderer.dispose();
    if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
  }

  function resetCamera() {
    if (!currentReplay || !controls) return;
    const cx = (currentReplay.cols - 1) * CELL / 2;
    const cz = (currentReplay.rows - 1) * CELL / 2;
    const dist = Math.max(currentReplay.cols, currentReplay.rows) * 0.9;
    camera.position.set(cx, dist * 0.85, cz + dist * 0.62);
    controls.target.set(cx, 0.5, cz);
    controls.update();
  }

  return {
    setReplay, renderFrame, dispose, resetCamera,
    get currentReplay() { return currentReplay; },
    get controls() { return controls; },
  };
}

// ============================================================
// TRAINING SCENE — small open arena, single PEP-Smol agent
// playing one animation clip. Used by the Training Center.
// ============================================================
function createTrainingScene(container, classId) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060c);
  scene.fog = new THREE.Fog(0x05060c, 8, 22);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 60);
  function resize() {
    const r = container.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  let controls = null;
  if (window.OrbitControls) {
    controls = new window.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.85;
    controls.zoomSpeed = 0.9;
    controls.minDistance = 2.4;
    controls.maxDistance = 9;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minPolarAngle = Math.PI * 0.10;
    controls.enablePan = false;
    controls.target.set(0, 0.7, 0);
  }

  // Lights — match the battle scene aesthetic
  scene.add(new THREE.AmbientLight(0x3a4060, 0.6));
  const sun = new THREE.DirectionalLight(0xfff2dc, 1.0);
  sun.position.set(4, 8, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -6; sun.shadow.camera.right = 6;
  sun.shadow.camera.top = 6; sun.shadow.camera.bottom = -6;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  const accent = new THREE.PointLight(0x5df2d6, 1.4, 12);
  accent.position.set(-2, 3, 2);
  scene.add(accent);

  // Arena floor + border
  const FLOOR_R = 4;
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(FLOOR_R, 48),
    new THREE.MeshStandardMaterial({ color: 0x0a0d1c, roughness: 0.95, metalness: 0.05 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(FLOOR_R * 2, 16, 0x1f2a48, 0x1a2238);
  grid.position.y = 0.01;
  scene.add(grid);

  // ============================================================
  // SKILL-SPECIFIC COURSES — ninja-warrior style obstacle layouts
  // built into the arena floor. Each skill gets a distinct set of
  // props so the user sees "what is being trained."
  // ============================================================
  let currentCourse = null;
  let courseAnimators = []; // [(dt) => void] per-frame hooks

  function disposeCourse() {
    if (!currentCourse) return;
    currentCourse.traverse((o) => {
      if (o.geometry) o.geometry.dispose?.();
      if (o.material) {
        const list = Array.isArray(o.material) ? o.material : [o.material];
        list.forEach((m) => m.dispose?.());
      }
    });
    scene.remove(currentCourse);
    currentCourse = null;
    courseAnimators = [];
  }

  function emissiveMat(hex, intensity = 0.55, opacity = 1) {
    return new THREE.MeshStandardMaterial({
      color: hex, emissive: hex, emissiveIntensity: intensity,
      roughness: 0.5, metalness: 0.25,
      transparent: opacity < 1, opacity,
    });
  }

  function buildCourse(skillId) {
    disposeCourse();
    const g = new THREE.Group();

    if (skillId === "walk") {
      // Zigzag chevrons on the floor — agent practices smooth gait
      const mat = emissiveMat(0x5df2d6, 0.7);
      for (let i = 0; i < 6; i++) {
        const arrow = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.18), mat);
        const z = -2.5 + i * 0.9;
        const x = (i % 2 === 0 ? -1 : 1) * 0.8;
        arrow.position.set(x, 0.04, z);
        arrow.rotation.y = (i % 2 === 0 ? 1 : -1) * Math.PI / 5;
        g.add(arrow);
      }
    }

    else if (skillId === "run") {
      // Sprint lane with chevrons + finish ribbon
      const chevMat = emissiveMat(0xffb84d, 0.65);
      for (let i = 0; i < 7; i++) {
        const arrow1 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.12), chevMat);
        const arrow2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.12), chevMat);
        const z = -2.7 + i * 0.8;
        arrow1.position.set(-0.3, 0.04, z); arrow1.rotation.y = Math.PI / 6;
        arrow2.position.set( 0.3, 0.04, z); arrow2.rotation.y = -Math.PI / 6;
        g.add(arrow1, arrow2);
      }
      // Finish ribbon
      const ribbon = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 0.04, 0.05),
        emissiveMat(0xfff066, 1.1)
      );
      ribbon.position.set(0, 1.4, 2.7);
      g.add(ribbon);
      const post1 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.4, 8), emissiveMat(0xffb84d, 0.6));
      post1.position.set(-1.2, 0.7, 2.7);
      const post2 = post1.clone(); post2.position.x = 1.2;
      g.add(post1, post2);
    }

    else if (skillId === "jump") {
      // Two raised platforms with a glowing gap between — practice the leap
      const platMat = emissiveMat(0xff9020, 0.45);
      const platA = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.35, 1.6), platMat);
      platA.position.set(-1.4, 0.175, 0);
      const platB = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.35, 1.6), platMat);
      platB.position.set(1.4, 0.175, 0);
      g.add(platA, platB);
      // Pit glow under the gap
      const pit = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.04, 1.6),
        emissiveMat(0xff4d6d, 1.0, 0.55)
      );
      pit.position.set(0, 0.02, 0);
      g.add(pit);
      // Side chevrons hinting the jump direction
      const chMat = emissiveMat(0xff9020, 0.7);
      for (let i = 0; i < 3; i++) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.08), chMat);
        c.position.set(-0.45 + i * 0.45, 0.06, 1.1);
        c.rotation.y = -Math.PI / 6;
        g.add(c);
      }
    }

    else if (skillId === "dodge") {
      // Three rotating poles to weave around
      const poleMat = emissiveMat(0xa973ff, 0.5);
      const armMat = emissiveMat(0xa973ff, 0.9);
      const xs = [-1.6, 0, 1.6];
      xs.forEach((x) => {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.8, 8), poleMat);
        pole.position.set(x, 0.9, 0);
        g.add(pole);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 0.08), armMat);
        arm.position.set(x, 1.2, 0);
        g.add(arm);
        // Animate rotation each frame
        courseAnimators.push((dt, elapsed) => {
          arm.rotation.y = elapsed * 1.2 + x;
        });
      });
    }

    else if (skillId === "attack") {
      // Three target dummies (vertical capsules with a red "hit zone")
      const bodyMat = emissiveMat(0x35304d, 0.2);
      const hitMat = emissiveMat(0xff4d6d, 0.85);
      const xs = [-1.5, 0, 1.5];
      xs.forEach((x) => {
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.9, 4, 8), bodyMat);
        body.position.set(x, 0.65, -0.4);
        g.add(body);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.04, 8, 24), hitMat);
        ring.position.set(x, 0.95, -0.4);
        ring.rotation.x = Math.PI / 2;
        g.add(ring);
        // Subtle pulse on the hit ring
        courseAnimators.push((dt, elapsed) => {
          const s = 1 + Math.sin(elapsed * 3 + x) * 0.1;
          ring.scale.setScalar(s);
        });
      });
    }

    else if (skillId === "combo") {
      // Five small target spheres around the agent — sequence of hits
      const targetMat = emissiveMat(0x5dd3f2, 0.95);
      for (let i = 0; i < 5; i++) {
        const ang = -Math.PI * 0.4 + (i / 4) * Math.PI * 0.8;
        const r = 1.6;
        const target = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), targetMat);
        target.position.set(Math.sin(ang) * r, 0.9 + i * 0.08, Math.cos(ang) * r);
        g.add(target);
        courseAnimators.push((dt, elapsed) => {
          target.position.y = (0.9 + i * 0.08) + Math.sin(elapsed * 2 + i) * 0.08;
        });
      }
    }

    scene.add(g);
    currentCourse = g;
  }

  // Progress ring on the ground — shows training-pack progress
  const progRingGeo = new THREE.RingGeometry(FLOOR_R * 0.78, FLOOR_R * 0.86, 64, 1, -Math.PI / 2, Math.PI * 2);
  const progRingMat = new THREE.MeshBasicMaterial({
    color: 0x5df2d6, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
  });
  const progRing = new THREE.Mesh(progRingGeo, progRingMat);
  progRing.rotation.x = -Math.PI / 2;
  progRing.position.y = 0.025;
  scene.add(progRing);

  // Spawn one PEP-Smol — duplicates the per-agent setup from makePepAgent
  // (kept self-contained so the training scene has no dependency on a sim)
  let model = null, mixer = null;
  const actions = {};
  const tintColor = parseColor((window.CLASSES?.[classId]?.color) || "#5df2d6");

  function applyTint(o) {
    if (!o.isMesh || !o.material) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    const next = list.map((m) => {
      const cm = m.clone();
      cm._om_cloned = true;
      if (cm.color && /hip|belly|chest|arm|forearm|leg|thigh|foot/i.test(cm.name || "")) {
        cm.color.copy(cm.color.clone().multiply(tintColor).lerp(tintColor, 0.55));
      }
      if (cm.emissive) cm.emissiveIntensity = Math.min(cm.emissiveIntensity ?? 1, 0.5);
      return cm;
    });
    o.material = Array.isArray(o.material) ? next : next[0];
    o.castShadow = true;
    o.receiveShadow = true;
  }

  if (window.PEP_BASE && !window.PEP_FAILED) {
    const tmp = window.PEP_BASE.scene.clone(true);
    const box = new THREE.Box3().setFromObject(tmp);
    const size = new THREE.Vector3(); box.getSize(size);
    const targetH = 1.6;
    const scale = targetH / Math.max(size.y, 0.1);
    const groundOffset = -box.min.y * scale;
    const cx = (box.min.x + box.max.x) / 2 * scale;
    const cz = (box.min.z + box.max.z) / 2 * scale;

    model = window.PEP_BASE.scene.clone(true);
    model.scale.setScalar(scale);
    model.position.set(-cx, groundOffset, -cz);
    model.traverse(applyTint);
    scene.add(model);

    mixer = new THREE.AnimationMixer(model);
    window.PEP_BASE.animations.forEach((clip) => {
      actions[clip.name] = mixer.clipAction(clip);
    });
  } else {
    // Capsule fallback if PEP failed to load
    const f = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.22, 0.6, 6, 12),
      new THREE.MeshStandardMaterial({ color: tintColor, roughness: 0.55 })
    );
    f.position.y = 0.7; f.castShadow = true;
    scene.add(f);
  }

  // Position camera for a "TV close-up" framing
  camera.position.set(2.6, 2.0, 3.4);
  camera.lookAt(0, 0.8, 0);
  if (controls) controls.update();

  let currentName = null;
  let currentAction = null;
  let baseSkill = null;          // The skill we're training on (returns here after stumble)
  let stumbleUntil = 0;          // When > performance.now(), agent is mid-stumble
  function setSkill(clipName, speed = 1) {
    baseSkill = { clipName, speed };
    if (!mixer) return;
    const next = actions[clipName];
    if (!next) return;
    next.setEffectiveTimeScale(speed);
    if (currentName === clipName) return;
    next.reset();
    next.setLoop(THREE.LoopRepeat, Infinity);
    next.setEffectiveWeight(1);
    next.play();
    if (currentAction && currentAction !== next) {
      currentAction.crossFadeTo(next, 0.28, false);
    }
    currentAction = next;
    currentName = clipName;
  }

  // Force a clip change ignoring the baseSkill memo — used internally for stumble
  function forceClip(clipName, speed = 1, loop = true) {
    if (!mixer) return;
    const next = actions[clipName];
    if (!next) return;
    next.reset();
    next.setEffectiveTimeScale(speed);
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    next.setEffectiveWeight(1);
    next.play();
    if (currentAction && currentAction !== next) {
      currentAction.crossFadeTo(next, 0.18, false);
    }
    currentAction = next;
    currentName = clipName;
  }

  function setSpeed(speed) {
    if (currentAction) currentAction.setEffectiveTimeScale(speed);
    if (baseSkill) baseSkill.speed = speed;
  }

  // Spark particle pool — duplicated from createScene3D's pattern but
  // scoped to the training arena so we can dispose cleanly on unmount.
  const tParticles = [];
  const tSparkGeo = new THREE.SphereGeometry(0.05, 6, 6);
  function tSpawnSparks(x, y, z, count, colorHex, life = 0.5) {
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: colorHex, transparent: true, opacity: 0.95,
      });
      const m = new THREE.Mesh(tSparkGeo, mat);
      m.position.set(x, y, z);
      const ang = Math.random() * Math.PI * 2;
      const horiz = 0.3 + Math.random() * 1.0;
      const up = 0.8 + Math.random() * 1.4;
      tParticles.push({
        mesh: m,
        vx: Math.cos(ang) * horiz,
        vy: up,
        vz: Math.sin(ang) * horiz,
        life: 0,
        maxLife: life * (0.7 + Math.random() * 0.5),
        scale0: 0.7 + Math.random() * 0.5,
      });
      scene.add(m);
    }
  }

  // markTrial — called by training.jsx after each simulated trial.
  // success=true  → small mint puff (celebratory)
  // success=false → crossfade to Get Hit for ~400 ms + red puff
  function markTrial(success) {
    if (success) {
      tSpawnSparks(0, 0.4, 0, 5, 0x5df2d6, 0.5);
    } else {
      tSpawnSparks(0, 0.4, 0, 6, 0xff4d6d, 0.55);
      stumbleUntil = performance.now() + 420;
      forceClip("Get Hit 01", 1.2, false);
    }
  }

  let progress = 0; // 0..1
  function setProgress(v) { progress = Math.max(0, Math.min(1, v)); }

  let elapsed = 0;
  function renderFrame(dt) {
    elapsed += dt;
    if (mixer) mixer.update(dt);

    // Recover from a stumble: when the window ends, return to the base skill
    if (stumbleUntil && performance.now() > stumbleUntil) {
      stumbleUntil = 0;
      if (baseSkill && baseSkill.clipName !== currentName) {
        forceClip(baseSkill.clipName, baseSkill.speed, true);
      }
    }

    // Progress ring grows from a tiny arc to full as `progress` rises
    const fullArc = Math.PI * 2;
    const arc = Math.max(0.0001, progress * fullArc);
    progRing.geometry.dispose();
    progRing.geometry = new THREE.RingGeometry(FLOOR_R * 0.78, FLOOR_R * 0.86, 64, 1, -Math.PI / 2, arc);
    progRing.material.opacity = 0.4 + Math.sin(elapsed * 4) * 0.15 + progress * 0.4;

    accent.intensity = 1.2 + Math.sin(elapsed * 2.4) * 0.4;

    // Per-frame course animation (rotating poles, target pulses, etc.)
    for (let i = 0; i < courseAnimators.length; i++) courseAnimators[i](dt, elapsed);

    // Update training-scene particles
    for (let i = tParticles.length - 1; i >= 0; i--) {
      const p = tParticles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        scene.remove(p.mesh);
        p.mesh.material.dispose();
        tParticles.splice(i, 1);
        continue;
      }
      const t = p.life / p.maxLife;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.vy -= 5.0 * dt;
      p.mesh.material.opacity = 0.95 * (1 - t);
      const s = p.scale0 * (1 - t * 0.5);
      p.mesh.scale.set(s, s, s);
    }

    if (controls) controls.update();
    renderer.render(scene, camera);
  }

  function dispose() {
    ro.disconnect();
    if (controls) controls.dispose();
    tParticles.forEach((p) => { scene.remove(p.mesh); p.mesh.material.dispose(); });
    tParticles.length = 0;
    tSparkGeo.dispose();
    disposeCourse();
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose?.();
      if (o.material) {
        const list = Array.isArray(o.material) ? o.material : [o.material];
        list.forEach((m) => m.dispose?.());
      }
    });
    renderer.dispose();
    if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
  }

  return {
    setSkill, setSpeed, setProgress, markTrial,
    setSkillCourse: buildCourse,
    renderFrame, dispose,
    get controls() { return controls; },
  };
}

// ============================================================
// RAGDOLL SCENE — used by the Balance training (Stage 0).
// Renders 5 capsule meshes that mirror a Rapier ragdoll's body
// transforms. The caller (balance-trainer.jsx) owns the Rapier
// world and brain; this module only paints what the physics says.
// ============================================================
function mountRagdollScene(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe8e8e8);
  scene.fog = null;  // no fog for training room

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 60);
  function resize() {
    const r = container.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  let controls = null;
  if (window.OrbitControls) {
    controls = new window.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 2.0;
    controls.maxDistance = 16.0;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minPolarAngle = Math.PI * 0.10;
    controls.enablePan = true;
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    controls.target.set(0, 1.0, 0);
  }
  camera.position.set(5.0, 3.0, 7.0);
  camera.lookAt(0, 1.5, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(4, 8, 3); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -6; sun.shadow.camera.right = 6;
  sun.shadow.camera.top = 6; sun.shadow.camera.bottom = -6;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  const accent = new THREE.PointLight(0x5df2d6, 1.2, 12);
  accent.position.set(-2, 3, 2);
  scene.add(accent);

  // ============================================================
  // TRAINING ROOM — large white space. Pan: middle-mouse drag.
  // ============================================================
  const ROOM_W = 10, ROOM_D = 10, ROOM_H = 4;
  const WALL_THICK = 0.3;
  const wallDimW = ROOM_W * 2, wallDimD = ROOM_D * 2;

  // White floor
  const floorGeo = new THREE.PlaneGeometry(wallDimW, wallDimD);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.15;
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(ROOM_W * 2, 16, 0x999999, 0xdddddd);
  grid.position.y = -0.13;
  scene.add(grid);

  const solidWallMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0 });
  // All walls solid — no transparent front wall

  function _addWall(x, y, z, w, h, d, mat) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  _addWall(0, ROOM_H / 2, -ROOM_D, wallDimW, ROOM_H, WALL_THICK, solidWallMat);
  _addWall(0, ROOM_H / 2, ROOM_D, wallDimW, ROOM_H, WALL_THICK, solidWallMat);
  _addWall(-ROOM_W, ROOM_H / 2, 0, WALL_THICK, ROOM_H, wallDimD, solidWallMat);
  _addWall(ROOM_W, ROOM_H / 2, 0, WALL_THICK, ROOM_H, wallDimD, solidWallMat);
  scene.add(grid);

  // ============================================================
  // PROP MESHES — generic geometry factory + lazy registry
  // ============================================================
  function _makePropMesh(spec) {
    let geom;
    const g = spec.geom || { type: "sphere", radius: 0.1 };
    if (g.type === "sphere")        geom = new THREE.SphereGeometry(g.radius || 0.1, 16, 12);
    else if (g.type === "box")      geom = new THREE.BoxGeometry(...(g.size || [0.2, 0.2, 0.2]).map((s) => s * 2));
    else if (g.type === "cylinder") geom = new THREE.CylinderGeometry(g.radius || 0.1, g.radius || 0.1, g.height || 0.4, 16);
    else if (g.type === "capsule")  geom = new THREE.CapsuleGeometry(g.radius || 0.1, (g.halfHeight || 0.2) * 2, 6, 12);
    else if (g.type === "cone")     geom = new THREE.ConeGeometry(g.radius || 0.2, g.height || 0.6, 16);
    else                            geom = new THREE.SphereGeometry(0.1, 8, 6);
    const mat = new THREE.MeshStandardMaterial({
      color: spec.color != null ? spec.color : 0x9bf0e0,
      emissive: spec.emissive != null ? spec.emissive : 0x000000,
      emissiveIntensity: 0.4,
      roughness: 0.45, metalness: 0.25,
    });
    const m = new THREE.Mesh(geom, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  // Map of prop name -> { mesh, spec }
  const propRegistry = new Map();
  // Dynamic prop factory (set per-env, e.g. for debris). Receives a name,
  // returns a visual spec or null. Falls back to a default debris mesh.
  let dynamicPropFactory = null;

  function setPropVisuals(propVisuals, dynamicFactory = null) {
    // Clear previous
    propRegistry.forEach(({ mesh }) => {
      scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    });
    propRegistry.clear();
    dynamicPropFactory = dynamicFactory;
    // Pre-create static props described in propVisuals
    (propVisuals || []).forEach((spec) => {
      const mesh = _makePropMesh(spec);
      if (spec.static) {
        // Decoration / fixed-position prop — placed once, never updated
        // by applyPropsSnapshot, visible immediately.
        mesh.position.set(spec.static.x, spec.static.y, spec.static.z);
        if (spec.static.rotY) mesh.rotation.y = spec.static.rotY;
        mesh.visible = true;
      } else {
        mesh.visible = false; // shows when first physics snapshot lands
      }
      scene.add(mesh);
      propRegistry.set(spec.name, { mesh, spec });
    });
  }

  function applyPropsSnapshot(propsMap) {
    if (!propsMap) return;
    for (const [name, transform] of Object.entries(propsMap)) {
      let entry = propRegistry.get(name);
      if (!entry) {
        // Lazy-create from dynamic factory (e.g. debris in L3)
        const spec = dynamicPropFactory
          ? dynamicPropFactory(name)
          : { name, geom: { type: "box", size: [0.13, 0.13, 0.13] }, color: 0x9bf0e0, emissive: 0x2a8a7a };
        if (!spec) continue;
        const mesh = _makePropMesh(spec);
        scene.add(mesh);
        entry = { mesh, spec };
        propRegistry.set(name, entry);
      }
      // Static props are pinned in place — don't overwrite their position
      if (entry.spec.static) continue;
      entry.mesh.visible = true;
      entry.mesh.position.set(transform.x, transform.y, transform.z);
      entry.mesh.quaternion.set(transform.qx, transform.qy, transform.qz, transform.qw);
    }
  }

  function setView(view) {
    if (!view) return;
    if (view.position) camera.position.set(view.position[0], view.position[1], view.position[2]);
    if (view.lookAt) camera.lookAt(view.lookAt[0], view.lookAt[1], view.lookAt[2]);
    if (controls) {
      controls.target.set(view.lookAt?.[0] ?? 0, view.lookAt?.[1] ?? 0.9, view.lookAt?.[2] ?? 0);
      controls.update();
    }
  }

  // ============================================================
  // SINGLE BEAR VIEW — one PEP-Smol on the platform, focused.
  // Was 4 bears side-by-side but that was confusing — training
  // should highlight the best brain's performance.
  // ============================================================
  const POPULATION = 1;
  const BEAR_OFFSETS = [0];     // centered on the platform
  const bears = [];   // each: { model, mixer, actions, legBones, currentAnim, currentAction, pendingJoints, groundOffset, cx, cz, offsetX }

  // Load PEP-Smol directly via ESM imports — bypasses the app preloader.
  // This is the same approach the diagnostic test page used (which worked).
  async function tryLoadPepSmolIntoScene(scene, bears, offsetX) {
    try {
      const urls = {
        three: 'https://unpkg.com/three@0.160.0/build/three.module.js',
        gltf: 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js',
        draco: 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/DRACOLoader.js',
      };
      const [THREE, { GLTFLoader }, { DRACOLoader }] = await Promise.all([
        import(/* @vite-ignore */ urls.three),
        import(/* @vite-ignore */ urls.gltf),
        import(/* @vite-ignore */ urls.draco).catch(() => ({ DRACOLoader: null })),
      ]);

      const loader = new GLTFLoader();
      if (DRACOLoader) {
        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath('https://unpkg.com/three@0.160.0/examples/jsm/libs/draco/');
        loader.setDRACOLoader(dracoLoader);
      }

      // Try Draco first, fall back to uncompressed
      let gltf = null;
      try {
        gltf = await new Promise((resolve, reject) => {
          loader.load('assets/pep-smol-draco.glb', resolve, undefined, reject);
        });
      } catch (e) {
        console.warn("[scene3d] Draco failed, trying uncompressed:", e?.message || e);
        gltf = await new Promise((resolve, reject) => {
          loader.load('assets/pep-smol.gltf', resolve, undefined, reject);
        });
      }

      if (!gltf || !gltf.scene) return;

      // Build the bear with bone tracking
      const model = gltf.scene;
      const legBones = {};
      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3(); box.getSize(size);
      const targetH = 2.27;
      const scale = targetH / Math.max(size.y, 0.1);
      const groundOffset = -box.min.y * scale;
      model.scale.setScalar(scale);
      model.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true; o.receiveShadow = true;
          if (o.material) { o.material.transparent = false; o.material.opacity = 1; o.material.depthWrite = true; }
        }
        if (o.name === "Left_Thigh-Local")  legBones.lHip  = { bone: o, restQuat: o.quaternion.clone() };
        if (o.name === "Right_Thigh-Local") legBones.rHip  = { bone: o, restQuat: o.quaternion.clone() };
        if (o.name === "Left_Leg-Local")    legBones.lShin = { bone: o, restQuat: o.quaternion.clone() };
        if (o.name === "Right_Leg-Local")   legBones.rShin = { bone: o, restQuat: o.quaternion.clone() };
      });
      model.position.set(offsetX, groundOffset, -1);
      model.castShadow = true; model.receiveShadow = true;

      // Remove old placeholder
      const oldBear = bears[0];
      if (oldBear && oldBear.model) scene.remove(oldBear.model);

      // Create new bear entry
      const bear = { _id: offsetX, model, mixer: null, actions: {}, legBones, currentAnim: null, currentAction: null, pendingJoints: null, groundOffset, cx: 0, cz: 0, offsetX };
      if (gltf.animations && gltf.animations.length) {
        bear.mixer = new THREE.AnimationMixer(model);
        gltf.animations.forEach((clip) => { bear.actions[clip.name] = bear.mixer.clipAction(clip); });
        const idle = gltf.animations.find(c => /idle 01/i.test(c.name)) || gltf.animations[0];
        if (idle) { const action = bear.mixer.clipAction(idle); action.play(); bear.currentAction = action; bear.currentAnim = idle.name; }
      }
      scene.add(model);
      bears[0] = bear;
    } catch (e) {
      console.error("[scene3d] Direct PEP-Smol load completely failed:", e);
    }
  }

  function _makeBearInstance(offsetX) {
    const legBones = {};
    let model = null, mixer = null;
    const actions = {};
    let groundOffset = 1.0, cx = 0, cz = 0;

    // Use preloaded PEP-Smol model (from app.html preloader)
    const hasBase = !!(window.PEP_BASE && !window.PEP_FAILED);
    const baseModel = hasBase ? window.PEP_BASE : null;

    if (baseModel) {
      const tmp = baseModel.scene.clone(true);
      const box = new THREE.Box3().setFromObject(tmp);
      const size = new THREE.Vector3(); box.getSize(size);
      const targetH = 2.27;
      const scale = targetH / Math.max(size.y, 0.1);
      groundOffset = -box.min.y * scale;
      cx = (box.min.x + box.max.x) / 2 * scale;
      cz = (box.min.z + box.max.z) / 2 * scale;

      model = baseModel.scene.clone(true);
      model.scale.setScalar(scale);
      model.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true; o.receiveShadow = true;
          if (o.material) {
            const list = Array.isArray(o.material) ? o.material : [o.material];
            o.material = Array.isArray(o.material) ? list.map(m => {
              const c = m.clone();
              c.transparent = false; c.opacity = 1; c.depthWrite = true;
              return c;
            }) : o.material.clone();
          }
        }
        if (o.name === "Left_Thigh-Local")  legBones.lHip  = { bone: o, restQuat: o.quaternion.clone() };
        if (o.name === "Right_Thigh-Local") legBones.rHip  = { bone: o, restQuat: o.quaternion.clone() };
        if (o.name === "Left_Leg-Local")    legBones.lShin = { bone: o, restQuat: o.quaternion.clone() };
        if (o.name === "Right_Leg-Local")   legBones.rShin = { bone: o, restQuat: o.quaternion.clone() };
      });

      model.updateWorldMatrix(true, false);
      const bonePositions = {};
      model.traverse((o) => {
        if (o.isBone && o.name) {
          const wp = new THREE.Vector3(); o.getWorldPosition(wp);
          bonePositions[o.name] = { x: wp.x, y: wp.y, z: wp.z };
        }
      });
      window._pepBonePositions = bonePositions;

      mixer = new THREE.AnimationMixer(model);
      baseModel.animations.forEach((clip) => {
        actions[clip.name] = mixer.clipAction(clip);
      });
    }

    // If model is null (PEP-Smol not loaded), create a prominent placeholder
    if (!model) {
      // Ground marker
      const markerGeo = new THREE.RingGeometry(0.3, 0.5, 32);
      const marker = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color: 0xff4488, side: THREE.DoubleSide }));
      marker.rotation.x = -Math.PI / 2;
      marker.position.set(offsetX, 0.05, -1);
      scene.add(marker);

      model = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.25, 1.0, 8, 16),
        new THREE.MeshStandardMaterial({ color: 0x5df2d6, roughness: 0.3, emissive: 0x2a8a7a, emissiveIntensity: 0.8 })
      );
      tryLoadPepSmolIntoScene(scene, bears, BEAR_OFFSETS[0] || 0);
    }

    model.position.set(offsetX, groundOffset, -1);
    model.castShadow = true;
    model.receiveShadow = true;
    scene.add(model);

    return { _id: offsetX, model, mixer, actions, legBones, currentAnim: null, currentAction: null, pendingJoints: null, groundOffset, cx, cz, offsetX };
  }

  // Build POPULATION bears at fixed X offsets
  for (let i = 0; i < POPULATION; i++) {
    bears.push(_makeBearInstance(BEAR_OFFSETS[i]));
  }

  // Convenience refs that previously pointed at a single bear — kept for
  // any code that didn't know about populations. They alias bears[0].
  let pepModel = bears[0]?.model || null;
  let pepMixer = bears[0]?.mixer || null;

  function playClip(name, fadeS = 0.25, loop = true, bearIdx = 0) {
    const b = bears[bearIdx];
    if (!b || !b.mixer) return;
    const next = b.actions[name];
    if (!next) return;
    if (b.currentAnim === name) return;
    next.reset();
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    next.clampWhenFinished = !loop;
    next.setEffectiveWeight(1);
    next.setEffectiveTimeScale(1);
    next.play();
    if (b.currentAction && b.currentAction !== next) {
      b.currentAction.crossFadeTo(next, fadeS, false);
    }
    b.currentAction = next;
    b.currentAnim = name;
  }
  // Start each bear with idle
  for (let i = 0; i < bears.length; i++) playClip("Idle 01", 0, true, i);

  // Apply a single Rapier snapshot to bear `bearIdx`. snap.bodies.torso
  // drives where THIS bear is rendered. Also updates physics debug skeleton.
  // TORSO_TO_FEET = ~1.79m — distance from ragdoll torso center to feet.
  // Computed from PEP-Smol proportions: TORSO_Y(1.72) - feet(-0.07) = 1.79
  const TORSO_TO_FEET = 1.79;

  // Physics body position indicators — small colored spheres at each ragdoll body
  const bodyMarkers = {};
  const markerColors = { torso: 0x5df2d6, lThigh: 0x5dd3f2, rThigh: 0x45d3ff, lShin: 0xffb84d, rShin: 0xff8b45, lFoot: 0xff5577, rFoot: 0xff4d9d };
  for (const [key, color] of Object.entries(markerColors)) {
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 8, 6),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthTest: false })
    );
    sphere.renderOrder = 999;
    sphere.visible = false;
    scene.add(sphere);
    bodyMarkers[key] = sphere;
  }

  function applySnapshot(snap, bearIdx = 0) {
    const b = bears[bearIdx];
    if (!b || !b.model) return;
    const bodies = (snap && snap.bodies) || snap;
    const torso = bodies?.torso;
    if (!torso) return;
    // Position model so its feet align with physics feet
    const ttF = (typeof window._ragdollTorsoToFeet === 'number') ? window._ragdollTorsoToFeet : TORSO_TO_FEET;
    b.model.position.set(
      torso.x - b.cx + b.offsetX,
      Math.max(0, torso.y - ttF) + (b.groundOffset || 0),
      torso.z - b.cz
    );
    b.model.quaternion.set(torso.qx, torso.qy, torso.qz, torso.qw);

    // Update physics body position indicators
    for (const [key, sphere] of Object.entries(bodyMarkers)) {
      const body = bodies[key];
      if (body) {
        sphere.visible = true;
        sphere.position.set(body.x, body.y, body.z);
      } else {
        sphere.visible = false;
      }
    }
  }

  const _legAxis = new THREE.Vector3(1, 0, 0);
  const _tmpQ = new THREE.Quaternion();
  let _smoothTargets = {}; // per-bear smoothed joint angles
  function applyJointAngles(joints, bearIdx = 0) {
    const b = bears[bearIdx];
    if (!b) return;
    b.pendingJoints = joints || null;
  }
  function _flushJointAngles() {
    for (const b of bears) {
      if (!b.pendingJoints) continue;
      if (!_smoothTargets[b._id]) _smoothTargets[b._id] = { lHip: 0, rHip: 0, lKnee: 0, rKnee: 0 };
      const tgt = _smoothTargets[b._id];
      // Damp toward target angles for smooth bone movement
      const DAMP = 0.6;  // snap to target angle quickly
      tgt.lHip = tgt.lHip + (b.pendingJoints.lHip - tgt.lHip) * DAMP;
      tgt.rHip = tgt.rHip + (b.pendingJoints.rHip - tgt.rHip) * DAMP;
      tgt.lKnee = tgt.lKnee + (b.pendingJoints.lKnee - tgt.lKnee) * DAMP;
      tgt.rKnee = tgt.rKnee + (b.pendingJoints.rKnee - tgt.rKnee) * DAMP;

      for (const name of ["lHip", "rHip", "lShin", "rShin"]) {
        const entry = b.legBones[name];
        if (!entry) continue;
        let angle;
        if (name === "lHip")       angle = tgt.lHip;
        else if (name === "rHip")  angle = tgt.rHip;
        else if (name === "lShin") angle = tgt.lKnee;
        else                       angle = tgt.rKnee;
        _tmpQ.setFromAxisAngle(_legAxis, angle);
        entry.bone.quaternion.copy(entry.restQuat).multiply(_tmpQ);
      }
    }
  }

  function setFallen(fallen, bearIdx = 0) {
    if (fallen) playClip("Death 01", 0.2, false, bearIdx);
    else        playClip("Idle 01",  0.3, true,  bearIdx);
  }

  function updateMixer(dt) {
    for (const b of bears) {
      if (b.mixer) b.mixer.update(dt);
    }
  }

  // How many visualised bears the scene supports — used by the trainer
  // to know how many parallel trace slots to fill.
  const populationSize = POPULATION;

  // Transient perturbation-cue marker (arrow that briefly appears at the
  // side that just pushed the ragdoll). Reused for both L2 and L3 envs.
  const cueGeo = new THREE.ConeGeometry(0.08, 0.22, 6);
  const cueMat = new THREE.MeshStandardMaterial({
    color: 0xff4d6d, emissive: 0xff2a4a, emissiveIntensity: 1.4,
    transparent: true, opacity: 0,
  });
  const cueMesh = new THREE.Mesh(cueGeo, cueMat);
  cueMesh.position.set(0, 1.0, 0);
  cueMesh.rotation.z = Math.PI / 2;
  scene.add(cueMesh);
  let cueExpiresAt = 0;

  function flashCue(cue) {
    if (!cue) return;
    // Place the arrow on the side the impulse came from, pointing inward
    if (cue.kind === "push") {
      cueMesh.position.set(cue.sign * 0.9, 1.0, 0);
      cueMesh.rotation.set(0, 0, cue.sign > 0 ? Math.PI / 2 : -Math.PI / 2);
    } else if (cue.kind === "push3d") {
      cueMesh.position.set(Math.cos(cue.theta) * 0.9, 1.0, Math.sin(cue.theta) * 0.9);
      cueMesh.lookAt(0, 1.0, 0);
      cueMesh.rotateX(Math.PI / 2);
    }
    cueExpiresAt = performance.now() + 240;
    cueMat.opacity = 0.95;
  }

  let elapsed = 0;
  function renderFrame(dt) {
    elapsed += dt;
    accent.intensity = 1.0 + Math.sin(elapsed * 2.4) * 0.3;
    updateMixer(dt);
    // Bone-driving — overwrite leg bone rotations AFTER mixer has run.
    // Without this the idle anim would re-set the leg bones each frame
    // and the physics joint angles would be lost.
    _flushJointAngles();
    // Cue fade
    if (cueExpiresAt) {
      const remaining = (cueExpiresAt - performance.now()) / 240;
      if (remaining <= 0) { cueMat.opacity = 0; cueExpiresAt = 0; }
      else cueMat.opacity = Math.max(0, remaining * 0.95);
    }
    if (controls) controls.update();
    renderer.render(scene, camera);
  }

  function dispose() {
    ro.disconnect();
    if (controls) controls.dispose();
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose?.();
      if (o.material) {
        const list = Array.isArray(o.material) ? o.material : [o.material];
        list.forEach((m) => m.dispose?.());
      }
    });
    renderer.dispose();
    if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
  }

  function disposeProps() {
    propRegistry.forEach(({ mesh }) => {
      scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    });
    propRegistry.clear();
  }

  return {
    applySnapshot, applyJointAngles, setFallen, flashCue, renderFrame, dispose,
    setPropVisuals, applyPropsSnapshot, disposeProps, setView,
    populationSize,
    get controls() { return controls; },
  };
}

Object.assign(window, {
  createScene3D, createTrainingScene, mountRagdollScene,
  parseColor, CELL_SIZE: CELL,
});
