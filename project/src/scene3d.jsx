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
          }
        }
      }
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

      // Position lerp
      const fx = sCur.x * CELL, fz = sCur.y * CELL;
      const tx = sNxt.x * CELL, tz = sNxt.y * CELL;
      v.curX = fx + (tx - fx) * fractional;
      v.curZ = fz + (tz - fz) * fractional;
      v.group.position.x = v.curX;
      v.group.position.z = v.curZ;

      // Death — clamp pose + clip
      if (!sCur.alive) {
        v.group.position.y = 0;
        if (v.alive) {
          // freshly killed
          playClip(v, "Death 01", 220, false, 1);
        }
        v.alive = false;
        v.hpSprite.visible = false;
        if (v.mixer) v.mixer.update(dt);
        return;
      }
      v.alive = true;
      v.group.position.y = 0;
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
  function setSkill(clipName, speed = 1) {
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

  function setSpeed(speed) {
    if (currentAction) currentAction.setEffectiveTimeScale(speed);
  }

  let progress = 0; // 0..1
  function setProgress(v) { progress = Math.max(0, Math.min(1, v)); }

  let elapsed = 0;
  function renderFrame(dt) {
    elapsed += dt;
    if (mixer) mixer.update(dt);

    // Progress ring grows from a tiny arc to full as `progress` rises
    const fullArc = Math.PI * 2;
    const arc = Math.max(0.0001, progress * fullArc);
    progRing.geometry.dispose();
    progRing.geometry = new THREE.RingGeometry(FLOOR_R * 0.78, FLOOR_R * 0.86, 64, 1, -Math.PI / 2, arc);
    progRing.material.opacity = 0.4 + Math.sin(elapsed * 4) * 0.15 + progress * 0.4;

    accent.intensity = 1.2 + Math.sin(elapsed * 2.4) * 0.4;
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

  return { setSkill, setSpeed, setProgress, renderFrame, dispose, get controls() { return controls; } };
}

Object.assign(window, { createScene3D, createTrainingScene, parseColor, CELL_SIZE: CELL });
