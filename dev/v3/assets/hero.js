/* N5Hero — three vertical columns of chamfered "blade" slabs standing on
 * static "chassis" slabs, bone satin-ceramic, violet chamfer emissive. Built
 * on a global THREE (UMD) provided by the host page.
 *
 * Round 4 rebuild (per critic notes + amended design-system.md):
 *  - the violet edge is EMISSIVE FACETS on the geometry (chamfer triangles
 *    whose local normal has x>0.3 && y>0.3), not a light — this is what the
 *    round-3 geometry analysis said was needed: a directional "rim" light
 *    can't isolate flat 45° chamfers from their neighbouring flat faces, but
 *    painting the chamfer's own triangles with an emissive material can,
 *    unconditionally, regardless of camera/lighting.
 *  - dropped clearcoat (frame-rate regression under headless SwiftShader);
 *    kept roughness 0.42 + a small (256x128) PMREM-generated grey environment
 *    for specular falloff.
 *  - twelve blades per column at rest (12/12/12, 18/18 while one chassis is
 *    dark), per the amended Presence bullet.
 *  - N5Hero.renderAt(ms) is a fully deterministic, stateless function of a
 *    single clock value — assembly AND the idle/failover schedule are both
 *    derived from it, so calling it twice with the same ms always paints
 *    the same frame. This replaces wall-clock/rAF-cadence guessing for
 *    screenshot tooling.
 */
(function(){
  'use strict';

  // Shared GLSL for the homemade bloom pipeline (deterministic, no randomness) —
  // module-scoped strings, reused by every N5HeroImpl instance.
  var BLOOM_QUAD_VERT = [
    'varying vec2 vUv;',
    'void main(){',
    '  vUv = uv;',
    '  gl_Position = vec4(position.xy, 0.0, 1.0);',
    '}'
  ].join('\n');

  var BLOOM_BRIGHT_FRAG = [
    'uniform sampler2D tDiffuse;',
    'uniform float threshold;',
    'varying vec2 vUv;',
    'void main(){',
    '  vec4 texel = texture2D(tDiffuse, vUv);',
    // key on violet-ness ONLY (blue over green). Bone is r>g>b, so bone
    // faces never bloom no matter how bright the key light makes them;
    // violet-lit bevels, the gaps and the emissive chamfers do. Values are
    // linear (the scene RT is not tone-mapped or sRGB-encoded).
    '  float violetness = max(0.0, texel.b - texel.g);',
    '  float contrib = smoothstep(threshold, threshold + 0.15, violetness);',
    '  gl_FragColor = vec4(texel.rgb * contrib, 1.0);',
    '}'
  ].join('\n');

  var BLOOM_BLUR_FRAG = [
    'uniform sampler2D tDiffuse;',
    'uniform vec2 texel;',
    'uniform vec2 direction;',
    'uniform float radius;',
    'varying vec2 vUv;',
    'void main(){',
    '  vec2 step = texel * direction * (radius / 4.0);',
    '  vec4 sum = texture2D(tDiffuse, vUv) * 0.227027;',
    '  sum += texture2D(tDiffuse, vUv + step * 1.0) * 0.1945946;',
    '  sum += texture2D(tDiffuse, vUv - step * 1.0) * 0.1945946;',
    '  sum += texture2D(tDiffuse, vUv + step * 2.0) * 0.1216216;',
    '  sum += texture2D(tDiffuse, vUv - step * 2.0) * 0.1216216;',
    '  sum += texture2D(tDiffuse, vUv + step * 3.0) * 0.0540540;',
    '  sum += texture2D(tDiffuse, vUv - step * 3.0) * 0.0540540;',
    '  sum += texture2D(tDiffuse, vUv + step * 4.0) * 0.0162162;',
    '  sum += texture2D(tDiffuse, vUv - step * 4.0) * 0.0162162;',
    '  gl_FragColor = sum;',
    '}'
  ].join('\n');

  var BLOOM_COMPOSITE_FRAG = [
    'uniform sampler2D tScene;',
    'uniform sampler2D tBloom;',
    'uniform float strength;',
    'varying vec2 vUv;',
    'void main(){',
    '  vec4 base = texture2D(tScene, vUv);',
    '  vec4 bloom = texture2D(tBloom, vUv);',
    '  vec3 color = base.rgb + bloom.rgb * strength;',
    '  gl_FragColor = vec4(color, 1.0);',
    // three.js renders materials with NoToneMapping whenever the target is a
    // WebGLRenderTarget, so the scene RT holds linear, un-tone-mapped light.
    // This pass writes to the screen: apply the renderer's ACES tone map and
    // the sRGB output transform here, exactly as a direct render would.
    '  #include <tonemapping_fragment>',
    '  #include <colorspace_fragment>',
    // premultiplied-alpha canvas over the page's carbon: keep the background
    // transparent, let bloom over empty space carry its own alpha so violet
    // bleeds into the ground instead of painting it black.
    '  float peak = max(gl_FragColor.r, max(gl_FragColor.g, gl_FragColor.b));',
    '  gl_FragColor.a = clamp(max(base.a, peak), 0.0, 1.0);',
    '}'
  ].join('\n');

  function N5HeroImpl(){
    var THREE_REF = null;
    var container = null;
    var canvas = null;
    var renderer = null;
    var scene = null;
    var camera = null;
    var raf = null;
    var destroyed = false;
    var reduced = false;
    // R5: once renderAt(ms) is called, the live rAF loop is paused for good
    // (not just cancelled for one frame) — nothing restarts it until
    // resumeLive() is called explicitly. Round-4's frames were overwritten
    // by the live loop racing in between renderAt() and the screenshot;
    // this flag is what that was missing.
    var livePaused = false;
    var mm = null;
    var onStateCb = null;

    // blade layout constants (design-system.md R7: 10/10/10 at rest, 8:6:1.6)
    var COLS = 3;
    var ROWS = 10;
    var BLADE_W = 1.6;   // wide
    var BLADE_D = 1.2;   // deep
    var BLADE_T = 0.32;  // thick (8:6:1.6) — R7: thick enough to read as a unit
    var GAP = BLADE_T * 0.5; // R7: visible dark gap between neighbours' violet ticks
    var COL_GAP = BLADE_W * 0.5; // R10: 0.35 fused columns 2/3 in isometric projection
    var STEP = BLADE_T + GAP; // vertical pitch between blade centres

    // chassis: wider, thicker, static (10:8:3, R7 — unmistakably thicker
    // than a blade so a bare chassis never reads as a stack)
    var UNIT = BLADE_W / 8; // 0.2
    var CHASSIS_W = 10 * UNIT;
    var CHASSIS_D = 8 * UNIT;
    var CHASSIS_T = 3 * UNIT;
    var CHASSIS_GAP = GAP * 1.5;

    var columns = []; // { group, blades:[...], material, edgeMaterial, materialArray, chassisMesh, currentCount }
    var bladeMaterialArray = null; // ONE global material for every blade, in every column — never darkens
    var blades = [];  // flat list of all blade records
    var colXs = [];
    var baseY = 0;
    var lastFrameTime = 0;
    var assemblyStartTime = null;
    var assemblyArmed = false;

    var seatDur = 700;  // R8 pacing
    var stagger = 120;  // R8 pacing
    var hoverOffset = 0; // computed once STEP is known

    var BONE_COLOR = 0xe4dfda;
    var DARK_COLOR = 0x5a5752; // R6 floor: never darker than this
    var BONE_ROUGHNESS = 0.15;  // R12 gloss: low roughness so the bone reads as a glossy,
                                 // reflective satin surface instead of a matte ceramic
    var DARK_ROUGHNESS = 0.9;
    var BONE_ENVMAP_INTENSITY = 0.9; // R9 gloss
    var BONE_CLEARCOAT = 0.6;         // R12 gloss: a real clearcoat layer, for the "shine"
                                       // the brief asks for on the top edge/side
    var BONE_CLEARCOAT_ROUGHNESS = 0.15; // R12 gloss: sharp, tight clearcoat highlight

    // R12 lighting model (site owner brief, 2026-09-08): retire the "violet
    // band" look (dark-violet base + strong emissive facets/rim light). The
    // edge is now only a faint lavender accent on the chamfer strip; the
    // chamfer and side materials otherwise track the bone colour exactly
    // like the top faces (see applyPowerToMaterials/makeColumnMaterials) —
    // any lavender the slabs carry comes from the gap-light reflection
    // (installGapShader/aGapFade) and the low ambient glow light below, not
    // from a painted-on band.
    var LAVENDER = 0xa493ff;      // design-system derived glow colour (gap planes, edge accent, under-light)
    var LAVENDER_DEEP = 0x7a5cff; // the reflection tint (albedo mix): deeper than LAVENDER so it keeps its colour under the white key (Eric 2026-09-08: "no saturation at all")
    var EDGE_COLOR = LAVENDER;
    var EDGE_INTENSITY = 0.3;     // edge accent

    // R12: a low, gentle lavender "under-cluster" light — a stand-in for the
    // per-blade gap lights (too many real PointLights to afford), positioned
    // toward the centre-right of the cluster and low, so it reads as
    // ambient under-lighting on undersides/chassis rather than a rim.
    var GLOW_LIGHT_COLOR = LAVENDER;
    var SIDE_EMISSIVE = 0; // R12: the flat side face no longer carries its own emissive tint
    var GLOW_LIGHT_INTENSITY = 20;    // PointLight intensity (candela) — gentle, not saturated
    var GLOW_LIGHT_DISTANCE = 22;     // falloff distance
    var GLOW_LIGHT_DECAY = 2;         // physically-based falloff
    var BLOOM_THRESHOLD = 0.3;        // violet-ness (b−g, linear) cutoff — high enough that only the pure lavender gap planes bloom, never tinted faces
    var BLOOM_STRENGTH = 0.45;        // R12: a soft halo on the lavender gap lines only, bone gloss must not bloom
    var BLOOM_RADIUS = 7;             // texel spread of the half-res gaussian blur

    // R12 lavender gap light under each slab (site owner brief): a thin
    // emissive plane, child of every blade mesh, sitting mid-gap under its
    // underside — see the blade-creation loop in buildScene(). Kept gentle
    // (opacity, not intensity) so it reads as a soft glow, not a saturated
    // light source.
    var GAP_GLOW_OPACITY = 1.0;
    var GAP_GLOW_INSET = 0.10;    // fraction inset from the blade footprint, each side
    var GAP_REFLECT_STRENGTH = 0.75; // installGapShader: how much of the tint the face takes at its top edge (albedo mix), fading to 0 at its bottom: emissive-radiance boost from aGapFade (linear: strongest at the gap above, fading down the face)

    var SHADOWS_ENABLED = true; // R12: white key light casts slight shadows (PCFSoftShadowMap)

    // Phone framing (Eric, 2026-09-08): the stage is the whole viewport behind
    // the transparent header (.tl) and clock block (.bl). The object lives in
    // the band between them — measured from the DOM at resize, so it also
    // fits when a real phone's browser bars shorten the viewport.
    var PORTRAIT_WIDTH_FRAC = 0.66;  // columns span this fraction of the width, unless the band is too short (was .85 when the stage was its own in-flow box)
    var PORTRAIT_DROP_PX = 45;       // object centre sits this far BELOW the band's centre (Eric: lower, clear of the logo)
    var PORTRAIT_MARGIN_PX = 12;     // phone: minimum gap kept between the object and the header / clock block
    var DESKTOP_MARGIN_PX = 24;      // desktop: minimum gap kept between the object and the viewport's top/bottom edges
    // On-screen vertical extent of the object about the world origin, in world
    // units at scale 1, over the WHOLE animation — the tallest state is a
    // failover, when a surviving column stacks 16 blades (far column: 5.8u
    // above the origin incl. its isometric depth offset; +0.1 for the bloom
    // halo). Bottom: the near chassis underside + halo, measured 3.9–4.0.
    var HERO_TOP_UNITS = 5.9;
    var HERO_BOT_UNITS = 4.0;

    var MIGRATE_DURATION = 700;
    var MIGRATE_STAGGER = 70;
    var FAILOVER_FADE = 600;
    var FAILOVER_INTERVAL = 12000;
    var FAILOVER_AWAY_DURATION = 4000;

    // R8 "idle is never still": up to TWO guest blades can be mid round-trip
    // at once — a new one spawns every 1.5s, each lasting ~3s, so a fresh
    // migration starts before the previous one finishes (spawn interval <
    // duration). assemblyTotalMs is set once buildScene knows the per-column
    // span.
    var assemblyTotalMs = 0;
    var IDLE_ACTIVE = 3000;
    var IDLE_SPAWN_INTERVAL = 1500;
    var IDLE_LIFT_BUMP = 0;

    // R6 arrival stream: the orthographic frustum does not reliably clip
    // the tall (up to 28 blade-height) pending positions on this camera/
    // scale combination (verified empirically — nothing was culled), so
    // visibility above the frame is enforced explicitly instead of relying
    // on frustum culling. Anything higher than this local Y is hidden;
    // anything at or below it is shown (continuous position, so a blade
    // simply fades into frustum-cull range as it falls — no popping).
    var visibleCeiling = 0;

    var glowLight = null;

    // R12: shared assets for the per-blade lavender gap-glow child planes —
    // ONE geometry + ONE material for every blade (see the blade-creation
    // loop in buildScene() and destroy()).
    var gapGlowGeo = null, gapGlowMat = null;

    // --- homemade bloom pipeline state (see buildBloomPipeline/setupBloomTargets/draw) ---
    var bloomScene = null, bloomCamera = null, quadGeo = null, quadMesh = null;
    var sceneRT = null, brightRT = null, blurRT1 = null, blurRT2 = null;
    var brightMat = null, blurMatH = null, blurMatV = null, compositeMat = null;

    var pointer = { x: null, y: null };

    var idlePhase = { state: 'stable', activeCol: -1 }; // stable | out | returning

    var breathT = 0;

    function makeChamferedGeometry(THREE, w, d, t, isChassis){
      // Straight (non-rounded) 45-degree chamfer, R9: 0.18 × thickness (down
      // from 0.3×t, which critics read as a wash across a third of the
      // face) — narrow enough that the emissive tick reads as a thin line.
      var chamfer = t * 0.18;
      var hw = w / 2, ht = t / 2;
      var shape = new THREE.Shape();
      shape.moveTo(-hw + chamfer, -ht);
      shape.lineTo(hw - chamfer, -ht);
      shape.lineTo(hw, -ht + chamfer);
      shape.lineTo(hw, ht - chamfer);
      shape.lineTo(hw - chamfer, ht);
      shape.lineTo(-hw + chamfer, ht);
      shape.lineTo(-hw, ht - chamfer);
      shape.lineTo(-hw, -ht + chamfer);
      shape.closePath();

      var extrudeSettings = {
        depth: d,
        bevelEnabled: true,
        bevelThickness: chamfer,
        bevelSize: chamfer,
        bevelSegments: 1,
        bevelOffset: 0,
        curveSegments: 1
      };
      var geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
      geo.translate(0, 0, -d / 2);

      // Non-indexed so every triangle owns its own vertices/normals (flat
      // per-facet shading), then classify each triangle: every chamfer
      // facet on the object's +x side (normal.x in (0.3, 0.95), i.e. not the
      // flat +x face itself) gets material index 1 (emissive violet edge) —
      // the top-right long edge AND the right-front / right-back vertical
      // chamfers.
      //
      // R7 fix: this must EXCLUDE the bottom-right chamfer (ny very
      // negative). Including it made two adjacent blades' violet ticks
      // (this blade's top-right chamfer + the blade above's bottom-right
      // chamfer) sit right across the gap from each other, reading as one
      // continuous band instead of ten distinct ticks. ny > -0.3 keeps the
      // top-right chamfer (ny > 0) and the vertical corner chamfers
      // (ny ~ 0) but drops the bottom-right one (ny ~ -0.7).
      geo = geo.toNonIndexed();
      geo.computeVertexNormals();
      var normAttr = geo.attributes.normal;
      var triCount = normAttr.count / 3;
      geo.clearGroups();
      for (var i = 0; i < triCount; i++){
        var nx = 0, ny = 0, nz = 0;
        for (var v = 0; v < 3; v++){
          nx += normAttr.getX(i * 3 + v);
          ny += normAttr.getY(i * 3 + v);
          nz += normAttr.getZ(i * 3 + v);
        }
        nx /= 3; ny /= 3; nz /= 3;
        // 0 = bone face, 1 = chamfer strip (emissive edge-light), 2 = the flat
        // right-hand face (violet-washed side, see SIDE_EMISSIVE)
        var matIndex = (nx > 0.3 && nx < 0.95 && ny > -0.3) ? 1 : (nx >= 0.95 ? 2 : 0);
        geo.addGroup(i * 3, 3, matIndex);
      }

      // R12: per-vertex "gap fade" attribute for the lavender under-slab
      // reflection (installGapShader) — 1.0 at the blade's top y (just under
      // the gap-glow plane above it), 0.0 at its bottom y, linear in local y.
      // Groups reuse this same geometry across all three material slots, so
      // this lives on the geometry, not the material. Chassis slabs get a
      // flat 0.0 (isChassis) — they have no gap light above them.
      var posAttr = geo.attributes.position;
      var fadeArr = new Float32Array(posAttr.count);
      for (var vi = 0; vi < posAttr.count; vi++){
        if (isChassis){
          fadeArr[vi] = 0.0;
        } else {
          var vy = posAttr.getY(vi);
          var fade = (vy + ht) / t; // ht/t are the same local vars used to build the shape above
          fadeArr[vi] = Math.min(1, Math.max(0, fade));
        }
      }
      geo.setAttribute('aGapFade', new THREE.BufferAttribute(fadeArr, 1));

      return geo;
    }

    // R12: installs the lavender gap-light reflection onto one material
    // instance via onBeforeCompile — wired to the aGapFade vertex attribute
    // set above. Applied to the bone face material AND the chamfer/side
    // materials (see makeColumnMaterials) so every face of a blade (and, as
    // a no-op on chassis where aGapFade is always 0, every chassis face)
    // picks up the same soft top-fading reflection. Uniforms are stashed on
    // material.userData.gapUniforms so applyPowerToMaterials can scale
    // uGapStrength by a failed column's power multiplier. customProgramCacheKey
    // returns a constant string so the several material clones this runs on
    // (bone/edge/side, per column, plus the global blade material set) share
    // one compiled program instead of each triggering its own recompile.
    function installGapShader(THREE, mat){
      var gapUniforms = {
        uGapTint: { value: new THREE.Color(LAVENDER_DEEP) },
        uGapStrength: { value: GAP_REFLECT_STRENGTH }
      };
      mat.userData.gapUniforms = gapUniforms;
      mat.onBeforeCompile = function(shader){
        shader.uniforms.uGapTint = gapUniforms.uGapTint;
        shader.uniforms.uGapStrength = gapUniforms.uGapStrength;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float aGapFade;\nvarying float vGapFade;\nvarying float vGapUp;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vGapFade = aGapFade;\n  vGapUp = normal.y; // object space == world orientation (blades never rotate)');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform vec3 uGapTint;\nuniform float uGapStrength;\nvarying float vGapFade;\nvarying float vGapUp;')
          // colour the face (albedo), don't add light to it: a bright bone face
          // plus added lavender only goes to white under ACES; a lavender-
          // coloured face under the white key reads as saturated colour.
          // the light is UNDER each slab: tops (normal up) stay bone; side faces
          // and the top-edge chamfers take the tint, strongest just under the gap
          .replace('#include <color_fragment>', '#include <color_fragment>\n  float gapMix = clamp(vGapFade * uGapStrength, 0.0, 1.0) * (1.0 - clamp(vGapUp, 0.0, 1.0));\n  diffuseColor.rgb = mix(diffuseColor.rgb, uGapTint, gapMix);')
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += uGapTint * gapMix * 0.12;');
      };
      mat.customProgramCacheKey = function(){ return 'n5hero-gap-v3'; };
    }

    function buildEnvironment(THREE){
      // Procedural neutral (greyscale-only, so it cannot tint the bone)
      // equirect, reduced to 256x128 (frame-rate regression fix) — near-
      // white top ("sky"), mid-grey horizon, dark floor, one soft brighter
      // "window" blob upper-left, so a satin ceramic material shows real
      // specular falloff across a face instead of one flat shaded value.
      var w = 256, h = 128;
      var cnv = document.createElement('canvas');
      cnv.width = w; cnv.height = h;
      var ctx = cnv.getContext('2d');
      var grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#f2efeb');
      grad.addColorStop(0.5, '#6b6863');
      grad.addColorStop(1, '#1a1916');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      var bx = w * 0.22, by = h * 0.18, br = w * 0.2;
      var blob = ctx.createRadialGradient(bx, by, 0, bx, by, br);
      blob.addColorStop(0, 'rgba(255,255,255,0.6)');
      blob.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = blob;
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.fill();

      var tex = new THREE.CanvasTexture(cnv);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;

      var pmrem = new THREE.PMREMGenerator(renderer);
      pmrem.compileEquirectangularShader();
      var envRT = pmrem.fromEquirectangular(tex);
      tex.dispose();
      pmrem.dispose();
      return envRT.texture;
    }

    function makeColumnMaterials(THREE){
      var material = new THREE.MeshPhysicalMaterial({
        color: BONE_COLOR,
        roughness: BONE_ROUGHNESS,
        metalness: 0.0,
        clearcoat: BONE_CLEARCOAT,
        clearcoatRoughness: BONE_CLEARCOAT_ROUGHNESS,
        envMapIntensity: BONE_ENVMAP_INTENSITY,
        // R9: flatShading:false — chamfers stay crisp regardless (each facet
        // already has its own non-shared, non-indexed vertex normals), but
        // now the fragment shader can interpolate across a face, letting the
        // specular highlight gradient actually show instead of one flat
        // per-facet shaded value.
        flatShading: false
      });
      installGapShader(THREE, material);

      // R12: chamfer strip — same bone colour as the top faces (no dark
      // violet base any more), with a faint lavender emissive accent so the
      // edge still reads as a thin line, not a saturated band.
      var edgeMaterial = material.clone();
      edgeMaterial.flatShading = false;
      edgeMaterial.emissive = new THREE.Color(EDGE_COLOR);
      edgeMaterial.emissiveIntensity = EDGE_INTENSITY;
      installGapShader(THREE, edgeMaterial);

      // R12: flat right-hand face — reads like the bone faces (no emissive
      // tint of its own); its lavender comes only from the gap-light
      // reflection (installGapShader) and the low glow light.
      var sideMaterial = material.clone();
      sideMaterial.flatShading = false;
      sideMaterial.emissive = new THREE.Color(0x000000);
      sideMaterial.emissiveIntensity = SIDE_EMISSIVE;
      installGapShader(THREE, sideMaterial);

      return { material: material, edgeMaterial: edgeMaterial, sideMaterial: sideMaterial };
    }

    function buildScene(THREE, w, h){
      scene = new THREE.Scene();
      scene.background = null;
      scene.environment = buildEnvironment(THREE);

      var aspect = w / h;
      var frustumH = 9;
      camera = new THREE.OrthographicCamera(
        -frustumH * aspect / 2, frustumH * aspect / 2,
        frustumH / 2, -frustumH / 2, 0.1, 100
      );
      // isometric-ish: elevation ~24deg, yaw ~35deg
      var dist = 18;
      var el = THREE.MathUtils.degToRad(24);
      var yaw = THREE.MathUtils.degToRad(35);
      camera.position.set(
        dist * Math.cos(el) * Math.sin(yaw),
        dist * Math.sin(el),
        dist * Math.cos(el) * Math.cos(yaw)
      );
      camera.lookAt(0, 0, 0);

      // --- lighting (R12, site owner brief): a white key light from the
      // upper left with slight shadows, a hemisphere fill so shadowed areas
      // never go black, and a low lavender glow light standing in for "a
      // light source under each slab" (the per-blade reflection itself is
      // the gap-glow shader, see installGapShader/aGapFade).
      var key = new THREE.DirectionalLight(0xf4f2ee, 3.2);
      key.position.set(-6, 7, 4);
      if (SHADOWS_ENABLED){
        key.castShadow = true;
        key.shadow.mapSize.set(2048, 2048);
        key.shadow.camera.left = -9;
        key.shadow.camera.right = 9;
        key.shadow.camera.top = 9;
        key.shadow.camera.bottom = -9;
        key.shadow.camera.near = 0.1;
        key.shadow.camera.far = 40;
        key.shadow.bias = -0.0005;
        key.shadow.normalBias = 0.02;
        key.shadow.camera.updateProjectionMatrix();
      }
      scene.add(key);
      scene.add(key.target);

      var hemi = new THREE.HemisphereLight(0xe4dfda, 0x2a2823, 0.45);
      scene.add(hemi);

      // R12: low lavender under-lighting, centred toward the cluster's
      // centre-right and low (per the "light source under each slab" brief)
      // — gentle intensity, not a saturated rim.
      glowLight = new THREE.PointLight(GLOW_LIGHT_COLOR, GLOW_LIGHT_INTENSITY, GLOW_LIGHT_DISTANCE, GLOW_LIGHT_DECAY);
      glowLight.position.set(3, -3, 3);
      scene.add(glowLight);

      var bladeGeo = makeChamferedGeometry(THREE, BLADE_W, BLADE_D, BLADE_T, false);
      var chassisGeo = makeChamferedGeometry(THREE, CHASSIS_W, CHASSIS_D, CHASSIS_T, true);

      // R12: shared gap-glow plane assets (one geometry + one material for
      // every blade) — a thin lavender emissive plane lying flat mid-gap,
      // inset from the blade footprint. Built once here; instanced as a
      // child of every blade mesh in the row loop below so it inherits
      // every migration/lift/assembly transform automatically.
      var gapW = BLADE_W * (1 - 2 * GAP_GLOW_INSET);
      var gapD = BLADE_D * (1 - 2 * GAP_GLOW_INSET);
      gapGlowGeo = new THREE.PlaneGeometry(gapW, gapD);
      gapGlowGeo.rotateX(-Math.PI / 2); // lie flat, normal +Y
      gapGlowMat = new THREE.MeshBasicMaterial({
        color: LAVENDER,
        transparent: true,
        opacity: GAP_GLOW_OPACITY,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: true
      });

      // Bug fix: blades were sharing their column's materialArray with that
      // column's CHASSIS mesh, so darkening the chassis on failover also
      // darkened any blade still pointing at it (including ones that had
      // already migrated and "landed" elsewhere, since the swap only ever
      // happens once, on landing, and only for the specific instant
      // t>=1 — anything captured slightly before that, or blades that never
      // got reassigned, stayed on the dark home material). Spec: only the
      // chassis darkens; every blade is bone + violet, in transit and on
      // landing, always — so blades now get ONE global material, shared
      // across every column, that updatePower() never touches.
      var globalBladeMats = makeColumnMaterials(THREE);
      bladeMaterialArray = [globalBladeMats.material, globalBladeMats.edgeMaterial, globalBladeMats.sideMaterial];

      var totalColsWidth = (COLS - 1) * (BLADE_W + COL_GAP);
      colXs = [];
      for (var c = 0; c < COLS; c++){
        colXs.push(-totalColsWidth / 2 + c * (BLADE_W + COL_GAP));
      }

      var stackHeight = ROWS * BLADE_T + (ROWS - 1) * GAP;
      baseY = -stackHeight / 2 + BLADE_T / 2 + (CHASSIS_T + CHASSIS_GAP) / 2;
      var chassisY = (baseY - BLADE_T / 2) - CHASSIS_GAP - CHASSIS_T / 2;

      columns = [];
      blades = [];

      var perColumnSpan = (ROWS - 1) * stagger + seatDur;
      assemblyTotalMs = COLS * perColumnSpan;
      IDLE_LIFT_BUMP = STEP * 3; // boosted so the R6 "already lifted at 4s" pop reads clearly
      // Pending-blade rest height for row i is baseY + STEP*(6+3i) (restY +
      // its own hover offset), so consecutive rows are 3*STEP apart. Set the
      // ceiling between row 0 and row 1's height: only the lowest pending
      // blade of an already-started column is visible at its very start —
      // "at most the lowest blade of column 1 entering from the top".
      visibleCeiling = baseY + STEP * 7.5;

      for (var ci = 0; ci < COLS; ci++){
        var group = new THREE.Group();
        group.position.x = colXs[ci];
        scene.add(group);

        // Chassis keeps its OWN per-column material (this is the only thing
        // that darkens on failover — blades below use the global, always-lit
        // bladeMaterialArray instead).
        var mats = makeColumnMaterials(THREE);
        var chassisMaterialArray = [mats.material, mats.edgeMaterial, mats.sideMaterial];

        var chassisMesh = new THREE.Mesh(chassisGeo, chassisMaterialArray);
        chassisMesh.position.set(0, chassisY, 0);
        chassisMesh.castShadow = true;
        chassisMesh.receiveShadow = true;
        group.add(chassisMesh);

        var colRec = {
          group: group,
          blades: [],
          index: ci,
          currentCount: ROWS,
          material: mats.material,
          edgeMaterial: mats.edgeMaterial,
          sideMaterial: mats.sideMaterial,
          materialArray: chassisMaterialArray, // chassis-only from here on
          chassisMesh: chassisMesh,
          powerMul: 1, // 1 = lit/bone, 0 = dark/matte (failover) — chassis only
          powerFadeStart: 0,
          powerFadeDuration: FAILOVER_FADE,
          powerTargetMul: 1
        };
        columns.push(colRec);

        var colStart = ci * perColumnSpan;

        for (var ri = 0; ri < ROWS; ri++){
          var mesh = new THREE.Mesh(bladeGeo, bladeMaterialArray);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          var restY = baseY + ri * STEP;

          // R12: lavender gap-glow child — a child of the blade mesh so it
          // follows every migration/lift/assembly transform automatically.
          // Sits mid-gap just under the blade's underside; never casts or
          // receives shadows itself.
          var gapGlow = new THREE.Mesh(gapGlowGeo, gapGlowMat);
          gapGlow.position.set(0, -BLADE_T / 2 - GAP * 0.5, 0);
          gapGlow.castShadow = false;
          gapGlow.receiveShadow = false;
          mesh.add(gapGlow);

          group.add(mesh);

          // R6 arrival stream: blade i starts at seat + (6 + 2*i) blade-
          // heights, so pending blades trail upward with widening spacing
          // (never a single parked stack a fixed distance above its seat) —
          // the higher ones sit off-frame above the canvas until their turn.
          var bladeHoverOffset = STEP * (6 + 2 * ri);

          var rec = {
            mesh: mesh,
            col: colRec,
            colIndex: ci,
            restY: restY,
            restZ: 0,
            rowIndex: ri,
            hoverOffset: bladeHoverOffset,
            colStartMs: colStart, // this blade's whole column is invisible before this
            assembleDelay: colStart + ri * stagger,
            anim: {
              type: 'assemble',
              delay: colStart + ri * stagger,
              duration: seatDur,
              fromY: restY + bladeHoverOffset,
              toY: restY,
              fromX: 0,
              toX: 0
            },
            _migration: null
          };
          mesh.position.set(0, rec.anim.fromY, 0);
          mesh.visible = colStart === 0 && rec.anim.fromY <= visibleCeiling;
          blades.push(rec);
          colRec.blades.push(rec);
        }
      }

      // Precompute each blade's migration plan (destination column + slot)
      // as if ITS OWN column were the one failing over. This is purely
      // geometric (row-alternation between the two other columns) and does
      // not depend on which column actually fails, so it can be computed
      // once, deterministically, at build time — used both by the live
      // incremental loop and by the analytic renderAt(ms) path.
      blades.forEach(function(rec){
        var others = [0, 1, 2].filter(function(c){ return c !== rec.colIndex; });
        var destColIndex = others[rec.rowIndex % 2];
        var countIntoDest = Math.floor(rec.rowIndex / 2);
        var slot = ROWS + countIntoDest;
        rec._migrationPlan = {
          destCol: destColIndex,
          slot: slot,
          targetLocalX: colXs[destColIndex] - colXs[rec.colIndex],
          targetLocalY: baseY + slot * STEP
        };
      });

      return { };
    }

    // ---------------------------------------------------------------------
    // Homemade bloom pipeline: full-res scene render -> half-res bright-pass
    // -> separable gaussian blur (H then V) -> additive composite to screen.
    // Built once per mount() from core THREE (ShaderMaterial/PlaneGeometry/
    // OrthographicCamera/Scene) since UnrealBloomPass/EffectComposer are not
    // available on this r158 UMD build. Every pass is a pure function of the
    // already-rendered frame — no randomness, so renderAt(ms) stays
    // deterministic for a given clock value.
    // ---------------------------------------------------------------------

    function buildBloomPipeline(THREE){
      bloomScene = new THREE.Scene();
      bloomCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      quadGeo = new THREE.PlaneGeometry(2, 2);

      brightMat = new THREE.ShaderMaterial({
        uniforms: { tDiffuse: { value: null }, threshold: { value: BLOOM_THRESHOLD } },
        vertexShader: BLOOM_QUAD_VERT,
        fragmentShader: BLOOM_BRIGHT_FRAG,
        depthTest: false,
        depthWrite: false
      });
      blurMatH = new THREE.ShaderMaterial({
        uniforms: {
          tDiffuse: { value: null },
          texel: { value: new THREE.Vector2() },
          direction: { value: new THREE.Vector2(1, 0) },
          radius: { value: BLOOM_RADIUS }
        },
        vertexShader: BLOOM_QUAD_VERT,
        fragmentShader: BLOOM_BLUR_FRAG,
        depthTest: false,
        depthWrite: false
      });
      blurMatV = new THREE.ShaderMaterial({
        uniforms: {
          tDiffuse: { value: null },
          texel: { value: new THREE.Vector2() },
          direction: { value: new THREE.Vector2(0, 1) },
          radius: { value: BLOOM_RADIUS }
        },
        vertexShader: BLOOM_QUAD_VERT,
        fragmentShader: BLOOM_BLUR_FRAG,
        depthTest: false,
        depthWrite: false
      });
      compositeMat = new THREE.ShaderMaterial({
        uniforms: {
          tScene: { value: null },
          tBloom: { value: null },
          strength: { value: BLOOM_STRENGTH }
        },
        vertexShader: BLOOM_QUAD_VERT,
        fragmentShader: BLOOM_COMPOSITE_FRAG,
        depthTest: false,
        depthWrite: false
      });

      quadMesh = new THREE.Mesh(quadGeo, brightMat);
      bloomScene.add(quadMesh);
    }

    // (Re)allocates the render targets at the given renderer drawing-buffer
    // size (already in device pixels — pass renderer.domElement.width/
    // height, not CSS size). Half-res for the bloom chain per spec. Must be
    // called wherever the renderer size or pixel ratio changes.
    function setupBloomTargets(THREE, w, h){
      var fullW = Math.max(1, Math.floor(w));
      var fullH = Math.max(1, Math.floor(h));
      var halfW = Math.max(1, Math.floor(fullW / 2));
      var halfH = Math.max(1, Math.floor(fullH / 2));

      if (sceneRT) sceneRT.dispose();
      if (brightRT) brightRT.dispose();
      if (blurRT1) blurRT1.dispose();
      if (blurRT2) blurRT2.dispose();

      // HDR (half-float) targets keep the key light's >1.0 values for the
      // tone map in the composite pass; MSAA on the scene target restores the
      // edge antialiasing the default framebuffer would have given us. Both
      // need WebGL2; fall back to clamped 8-bit targets without it.
      var gl2 = !!(renderer && renderer.capabilities && renderer.capabilities.isWebGL2);
      var hdr = gl2 && (renderer.extensions.has('EXT_color_buffer_float') ||
                        renderer.extensions.has('EXT_color_buffer_half_float'));
      var texType = hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;
      var sceneOpts = {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: texType,
        depthBuffer: true,
        stencilBuffer: false,
        samples: gl2 ? 4 : 0
      };
      var bloomOpts = {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: texType,
        depthBuffer: false,
        stencilBuffer: false
      };

      sceneRT = new THREE.WebGLRenderTarget(fullW, fullH, sceneOpts);
      brightRT = new THREE.WebGLRenderTarget(halfW, halfH, bloomOpts);
      blurRT1 = new THREE.WebGLRenderTarget(halfW, halfH, bloomOpts);
      blurRT2 = new THREE.WebGLRenderTarget(halfW, halfH, bloomOpts);

      blurMatH.uniforms.texel.value.set(1 / halfW, 1 / halfH);
      blurMatV.uniforms.texel.value.set(1 / halfW, 1 / halfH);
    }

    // Single entry point for every frame: renders the real scene, runs the
    // bloom chain, composites to the screen. All four renderer.render()
    // call sites go through this so renderAt(ms)/the live loop/pause-resume
    // all produce identical output for the same scene state.
    function draw(){
      if (!renderer || !scene || !camera) return;
      if (!bloomScene || !sceneRT){
        // Bloom pipeline not ready (shouldn't happen post-mount) — direct
        // render rather than throwing.
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
        return;
      }

      var prevTarget = renderer.getRenderTarget();

      renderer.setRenderTarget(sceneRT);
      renderer.render(scene, camera);

      quadMesh.material = brightMat;
      brightMat.uniforms.tDiffuse.value = sceneRT.texture;
      renderer.setRenderTarget(brightRT);
      renderer.render(bloomScene, bloomCamera);

      quadMesh.material = blurMatH;
      blurMatH.uniforms.tDiffuse.value = brightRT.texture;
      renderer.setRenderTarget(blurRT1);
      renderer.render(bloomScene, bloomCamera);

      quadMesh.material = blurMatV;
      blurMatV.uniforms.tDiffuse.value = blurRT1.texture;
      renderer.setRenderTarget(blurRT2);
      renderer.render(bloomScene, bloomCamera);

      quadMesh.material = compositeMat;
      compositeMat.uniforms.tScene.value = sceneRT.texture;
      compositeMat.uniforms.tBloom.value = blurRT2.texture;
      renderer.setRenderTarget(null);
      renderer.render(bloomScene, bloomCamera);

      renderer.setRenderTarget(prevTarget);
    }

    function easeOutCubic(t){ return 1 - Math.pow(1 - t, 3); }
    function easeInOutCubic(t){ return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

    // Deterministic "up to two guests migrating at once" schedule (R8):
    // cycles rotate through columns (0->1, 1->2, 2->0, ...), a new one
    // spawning every 1.5s, each a ~3s round trip — since the spawn interval
    // (1.5s) is less than the duration (3s), two are in flight simultaneously
    // in steady state. Returns [] when nothing should be visiting (still
    // assembling, or a failover is in progress anywhere — idle migration
    // never runs during a failover).
    function computeIdleMigrations(ms){
      if (ms < assemblyTotalMs) return [];
      if (computeFailoverPhase(ms)) return []; // never during a failover
      var since = ms - assemblyTotalMs;
      var maxCycle = Math.floor(since / IDLE_SPAWN_INTERVAL);
      var results = [];
      for (var n = Math.max(0, maxCycle - 3); n <= maxCycle; n++){
        var phaseMs = since - n * IDLE_SPAWN_INTERVAL;
        if (phaseMs >= 0 && phaseMs < IDLE_ACTIVE){
          results.push({ source: n % COLS, dest: (n + 1) % COLS, phaseMs: phaseMs, rowIndex: ROWS - 1, cycle: n });
        }
      }
      return results;
    }

    function findIdleMigrationFor(migrations, colIndex, rowIndex){
      for (var i = 0; i < migrations.length; i++){
        if (migrations[i].source === colIndex && migrations[i].rowIndex === rowIndex) return migrations[i];
      }
      return null;
    }

    // ---------------------------------------------------------------------
    // Deterministic analytic path: N5Hero.renderAt(ms)
    // ---------------------------------------------------------------------

    // Which column (if any) is mid-failover at time `ms`, and how far into
    // that cycle we are. Column choice cycles deterministically (0,1,2,...)
    // rather than randomly, so repeated calls are reproducible.
    function computeFailoverPhase(ms){
      if (ms < FAILOVER_INTERVAL) return null;
      var sinceFirst = ms - FAILOVER_INTERVAL;
      var cycleIndex = Math.floor(sinceFirst / FAILOVER_INTERVAL);
      var phaseMs = sinceFirst - cycleIndex * FAILOVER_INTERVAL;
      var col = cycleIndex % COLS;
      return { col: col, phaseMs: phaseMs, cycleIndex: cycleIndex };
    }

    function computeColumnPowerMulAt(colIndex, ms){
      var phase = computeFailoverPhase(ms);
      if (!phase || phase.col !== colIndex) return 1;
      var T0 = FAILOVER_INTERVAL + phase.cycleIndex * FAILOVER_INTERVAL;
      var T1 = T0 + FAILOVER_AWAY_DURATION;
      if (ms < T0) return 1;
      if (ms < T0 + FAILOVER_FADE) return 1 - (ms - T0) / FAILOVER_FADE;
      if (ms < T1) return 0;
      if (ms < T1 + FAILOVER_FADE) return (ms - T1) / FAILOVER_FADE;
      return 1;
    }

    function applyPowerToMaterials(colRec, mul){
      if (!_boneColor){
        _boneColor = new THREE_REF.Color(BONE_COLOR);
        _darkColor = new THREE_REF.Color(DARK_COLOR);
      }
      colRec.powerMul = mul;
      colRec.material.color.copy(_darkColor).lerp(_boneColor, mul);
      colRec.material.roughness = DARK_ROUGHNESS + (BONE_ROUGHNESS - DARK_ROUGHNESS) * mul;
      colRec.material.clearcoat = BONE_CLEARCOAT * mul; // matte when dark, glossy when lit
      // R12: edge/side materials track the bone colour exactly (no more dark
      // violet base to lerp toward) — only their faint emissive accents fade
      // with the column's power.
      colRec.edgeMaterial.color.copy(colRec.material.color);
      colRec.edgeMaterial.roughness = colRec.material.roughness;
      colRec.edgeMaterial.clearcoat = colRec.material.clearcoat;
      colRec.edgeMaterial.emissiveIntensity = EDGE_INTENSITY * mul;
      if (colRec.sideMaterial){
        colRec.sideMaterial.color.copy(colRec.material.color);
        colRec.sideMaterial.roughness = colRec.material.roughness;
        colRec.sideMaterial.clearcoat = colRec.material.clearcoat;
        colRec.sideMaterial.emissiveIntensity = SIDE_EMISSIVE * mul;
      }
      // R12: dim the gap-light reflection along with the rest of a failed
      // column's power.
      if (colRec.material.userData.gapUniforms) colRec.material.userData.gapUniforms.uGapStrength.value = GAP_REFLECT_STRENGTH * mul;
      if (colRec.edgeMaterial.userData.gapUniforms) colRec.edgeMaterial.userData.gapUniforms.uGapStrength.value = GAP_REFLECT_STRENGTH * mul;
      if (colRec.sideMaterial && colRec.sideMaterial.userData.gapUniforms) colRec.sideMaterial.userData.gapUniforms.uGapStrength.value = GAP_REFLECT_STRENGTH * mul;
      updateGlowLightIntensity();
    }

    // One shared PointLight lights all three columns, so its intensity
    // tracks the AVERAGE powerMul across columns — dims together with
    // whichever column's emissive is fading down/up on failover.
    function updateGlowLightIntensity(){
      if (!glowLight || !columns.length) return;
      var sum = 0;
      for (var i = 0; i < columns.length; i++){ sum += columns[i].powerMul; }
      glowLight.intensity = GLOW_LIGHT_INTENSITY * (sum / columns.length);
    }

    function computeBladeTransformAt(rec, ms){
      // 1. Assembly — always evaluated first; this is what's on screen
      //    before ms reaches this blade's seat time.
      var elapsed = ms - rec.assembleDelay;
      var assemblyY;
      if (elapsed <= 0){
        assemblyY = rec.restY + rec.hoverOffset;
      } else {
        var t = Math.min(1, elapsed / seatDur);
        var e = easeOutCubic(t);
        assemblyY = (rec.restY + rec.hoverOffset) + (rec.restY - (rec.restY + rec.hoverOffset)) * e;
      }
      var assemblyDone = elapsed >= seatDur;

      if (!assemblyDone){
        // "Pending" (elapsed<=0, hasn't begun its own descent yet) is the
        // ONLY state the visibility ceiling applies to. Once a blade has
        // started descending it stays visible all the way through seating —
        // the ceiling must never re-hide an already-seated blade whose
        // restY happens to sit above it (rows 8-12 do, since the ceiling is
        // tuned to show just one pending blade, not a whole column).
        return { x: 0, y: assemblyY, z: 0, materialArray: bladeMaterialArray, pending: elapsed <= 0 };
      }

      var phase = computeFailoverPhase(ms);
      if (!phase || phase.col !== rec.colIndex){
        // Not this blade's failover. Is it the one guest currently on its
        // idle round trip?
        var idle = findIdleMigrationFor(computeIdleMigrations(ms), rec.colIndex, rec.rowIndex);
        if (idle){
          var destColIdle = columns[idle.dest];
          var targetX = colXs[idle.dest] - colXs[idle.source];
          var targetY = baseY + ROWS * STEP; // one slot above the dest's own 12
          if (idle.phaseMs < IDLE_ACTIVE / 2){
            // ease-out (not in-out): R6 needs a10 (4s, only ~40ms into this
            // cycle) to already show a visible lift — an ease-in start would
            // read as motionless at that point.
            var ti = idle.phaseMs / (IDLE_ACTIVE / 2);
            var ei = easeOutCubic(ti);
            var bumpi = Math.sin(Math.min(1, ti) * Math.PI) * IDLE_LIFT_BUMP;
            return {
              x: targetX * ei,
              y: rec.restY + (targetY - rec.restY) * ei + bumpi,
              z: 0,
              materialArray: bladeMaterialArray // visiting, never darkens
            };
          }
          var ti2 = (idle.phaseMs - IDLE_ACTIVE / 2) / (IDLE_ACTIVE / 2);
          var ei2 = easeOutCubic(ti2);
          var bumpi2 = Math.sin(Math.min(1, ti2) * Math.PI) * IDLE_LIFT_BUMP;
          return {
            x: targetX * (1 - ei2),
            y: targetY + (rec.restY - targetY) * ei2 + bumpi2,
            z: 0,
            materialArray: bladeMaterialArray
          };
        }
        return { x: 0, y: rec.restY, z: 0, materialArray: bladeMaterialArray };
      }

      var T0 = FAILOVER_INTERVAL + phase.cycleIndex * FAILOVER_INTERVAL;
      var T1 = T0 + FAILOVER_AWAY_DURATION;
      var i = rec.rowIndex;
      var outStart = T0 + i * MIGRATE_STAGGER, outEnd = outStart + MIGRATE_DURATION;
      var backStart = T1 + i * MIGRATE_STAGGER, backEnd = backStart + MIGRATE_DURATION;
      var mig = rec._migrationPlan;
      var destCol = columns[mig.destCol];

      if (ms < outStart){
        return { x: 0, y: rec.restY, z: 0, materialArray: bladeMaterialArray };
      }
      if (ms < outEnd){
        var t1 = (ms - outStart) / MIGRATE_DURATION;
        var e1 = easeOutCubic(t1);
        var bump1 = Math.sin(Math.min(1, t1) * Math.PI) * STEP * 2.2 * (1 - t1);
        return {
          x: mig.targetLocalX * e1,
          y: rec.restY + (mig.targetLocalY - rec.restY) * e1 + bump1,
          // Ghost-plank fix: a blade in transit geometrically overlaps
          // stationary blades in the columns it crosses (same Y, briefly
          // near the same X), which Z-fights and reads as a flickering,
          // semi-transparent plank — not a material/opacity bug (nothing in
          // this file sets transparent/opacity/depthWrite). A small fixed
          // forward nudge while in flight breaks the coincidence.
          z: 0.03,
          materialArray: bladeMaterialArray // still "home" while lifting off
        };
      }
      if (ms < backStart){
        return { x: mig.targetLocalX, y: mig.targetLocalY, z: 0, materialArray: bladeMaterialArray };
      }
      if (ms < backEnd){
        var t2 = (ms - backStart) / MIGRATE_DURATION;
        var e2 = easeOutCubic(t2);
        var bump2 = Math.sin(Math.min(1, t2) * Math.PI) * STEP * 1.6 * (1 - t2);
        return {
          x: mig.targetLocalX * (1 - e2),
          y: mig.targetLocalY + (rec.restY - mig.targetLocalY) * e2 + bump2,
          z: 0.03,
          materialArray: bladeMaterialArray
        };
      }
      return { x: 0, y: rec.restY, z: 0, materialArray: bladeMaterialArray };
    }

    function renderAt(ms){
      if (destroyed || !renderer) return;
      livePaused = true;
      if (raf){ cancelAnimationFrame(raf); raf = null; }
      columns.forEach(function(colRec, idx){
        applyPowerToMaterials(colRec, computeColumnPowerMulAt(idx, ms));
      });
      blades.forEach(function(rec){
        var s = computeBladeTransformAt(rec, ms);
        rec.mesh.position.set(s.x, s.y, s.z);
        if (rec.mesh.material !== s.materialArray) rec.mesh.material = s.materialArray;
        // The ceiling only ever hides a PENDING blade (hasn't begun its own
        // descent) — gated additionally on its whole column having started
        // (so column 2/3 show nothing but chassis before their turn). Once
        // a blade has begun descending, is seated, migrating, or pointer-
        // pulled, it is always visible — the ceiling must never re-hide an
        // already-seated blade whose restY sits above it (rows 8-12 do).
        rec.mesh.visible = s.pending ? ((ms >= rec.colStartMs) && (s.y <= visibleCeiling)) : true;
      });
      window.__n5t = ms;
      draw();
    }

    // ---------------------------------------------------------------------
    // Live/incremental path (real site usage): rAF loop, real timers,
    // pointer input, random failover column choice.
    // ---------------------------------------------------------------------

    function updateAssembly(nowMs){
      if (!assemblyArmed) return false;
      if (assemblyStartTime === null) assemblyStartTime = nowMs;
      var allSeated = true;
      blades.forEach(function(rec){
        var a = rec.anim;
        if (a.type !== 'assemble') return;
        var elapsedSinceStart = nowMs - assemblyStartTime;
        var columnStarted = elapsedSinceStart >= rec.colStartMs;
        var elapsed = elapsedSinceStart - a.delay;
        if (elapsed <= 0){
          rec.mesh.position.y = a.fromY;
          rec.mesh.visible = columnStarted && a.fromY <= visibleCeiling;
          allSeated = false;
          return;
        }
        var t = Math.min(1, elapsed / a.duration);
        var e = easeOutCubic(t);
        rec.mesh.position.y = a.fromY + (a.toY - a.fromY) * e;
        rec.mesh.visible = true; // already descending — never re-hidden by the ceiling
        if (t >= 1){
          rec.anim.type = 'seated';
          rec.mesh.position.y = a.toY;
          rec.mesh.visible = true;
        } else {
          allSeated = false;
        }
      });
      return allSeated;
    }

    var failoverTimerId = null;
    var lastFailoverTime = -Infinity;

    function startFailover(nowMs){
      var candidates = [0, 1, 2];
      var col = candidates[Math.floor(Math.random() * candidates.length)];
      var colRec = columns[col];
      var others = candidates.filter(function(i){ return i !== col; });

      idlePhase.state = 'out';
      idlePhase.activeCol = col;

      if (onStateCb) { try { onStateCb(2); } catch(e){} }

      colRec.powerFadeStart = nowMs;
      colRec.powerFadeDuration = FAILOVER_FADE;
      colRec.powerTargetMul = 0;

      colRec.blades.forEach(function(rec, i){
        var mig = rec._migrationPlan; // reuse the precomputed plan
        var destCol = columns[mig.destCol];
        destCol.currentCount += 1;

        rec.anim = {
          type: 'migrateOut',
          _t0: nowMs + i * MIGRATE_STAGGER,
          startTime: null,
          duration: MIGRATE_DURATION,
          fromX: rec.mesh.position.x,
          toX: mig.targetLocalX,
          fromY: rec.mesh.position.y,
          toY: mig.targetLocalY,
          liftBump: STEP * 2.2,
          destMaterial: bladeMaterialArray
        };
        rec._migration = mig;
      });
      colRec.currentCount = 0;

      lastFailoverTime = nowMs;

      failoverTimerId = setTimeout(function(){
        returnFailover(col);
      }, FAILOVER_AWAY_DURATION);
    }

    function returnFailover(col){
      if (destroyed) return;
      var nowMs = performance.now();
      var colRec = columns[col];
      idlePhase.state = 'returning';
      if (onStateCb) { try { onStateCb(3); } catch(e){} }

      colRec.powerFadeStart = nowMs;
      colRec.powerFadeDuration = FAILOVER_FADE;
      colRec.powerTargetMul = 1;

      colRec.blades.forEach(function(rec, i){
        var mig = rec._migration;
        if (mig){
          columns[mig.destCol].currentCount -= 1;
        }
        rec.anim = {
          type: 'migrateBack',
          _t0: nowMs + i * MIGRATE_STAGGER,
          startTime: null,
          duration: MIGRATE_DURATION,
          fromX: rec.mesh.position.x,
          toX: 0,
          fromY: rec.mesh.position.y,
          toY: rec.restY,
          liftBump: STEP * 1.6,
          destMaterial: bladeMaterialArray
        };
        rec._migration = null;
      });
      colRec.currentCount = ROWS;

      setTimeout(function(){
        idlePhase.state = 'stable';
      }, 900);
    }

    function updateMigration(nowMs){
      blades.forEach(function(rec){
        var a = rec.anim;
        if (a.type !== 'migrateOut' && a.type !== 'migrateBack') return;
        if (a.startTime === null){
          if (nowMs < a._t0) return;
          a.startTime = nowMs;
        }
        var elapsed = nowMs - a.startTime;
        var t = Math.min(1, elapsed / a.duration);
        var e = easeOutCubic(t);
        var bump = Math.sin(Math.min(1, t) * Math.PI) * (a.liftBump || 0) * (1 - t);
        rec.mesh.position.x = a.fromX + (a.toX - a.fromX) * e;
        rec.mesh.position.y = a.fromY + (a.toY - a.fromY) * e + bump;
        // Diagnosed ghost-plank bug: a blade in transit crosses through the
        // same Y (and briefly near the same X) as stationary blades in the
        // columns it passes between/over, which genuinely overlaps their
        // geometry (not a material/opacity issue — nothing in this file
        // sets transparent/opacity/depthWrite) and produces the flickering,
        // semi-transparent-looking Z-fighting a page critic read as a
        // "ghost plank". A small, fixed forward nudge during transit only
        // breaks the coincidence deterministically without being visible as
        // a shift; it resets to exactly restZ the moment it lands.
        rec.mesh.position.z = rec.restZ + 0.03;
        if (t >= 1){
          rec.mesh.position.x = a.toX;
          rec.mesh.position.y = a.toY;
          rec.mesh.position.z = rec.restZ;
          if (a.destMaterial) rec.mesh.material = a.destMaterial;
          rec.anim = { type: 'seated' };
        }
      });
    }

    // Pointer: drawer pull (R9: 60% of blade depth, PLUS a 0.4×BLADE_T lift
    // so the pulled blade visibly breaks the stack silhouette — two critics
    // could not see a depth-only pull at page scale). This never touches
    // material — only position.z/y — so a pointer-pulled blade always keeps
    // its current lit/dark material as-is.
    function updatePointer(nowMs){
      if (pointer.x === null || !canvas) return;
      var rect = canvas.getBoundingClientRect();
      blades.forEach(function(rec){
        if (rec.anim.type === 'assemble' || rec.anim.type === 'migrateOut' || rec.anim.type === 'migrateBack' || rec.anim.type === 'idleVisiting') return;
        var worldPos = new THREE_REF.Vector3();
        rec.mesh.getWorldPosition(worldPos);
        var screenPos = worldPos.clone().project(camera);
        var sx = (screenPos.x * 0.5 + 0.5) * rect.width + rect.left;
        var sy = (-screenPos.y * 0.5 + 0.5) * rect.height + rect.top;
        var dx = sx - pointer.x, dy = sy - pointer.y;
        var dist = Math.sqrt(dx*dx + dy*dy);
        var within = dist < 180;

        // 'pointerOut' (mid-pull) and 'pointerHeld' (fully pulled, holding)
        // are both "currently pulled" — a blade almost always reaches
        // pointerHeld well before the pointer moves away (250ms pull vs. a
        // slow sweep), so the release check must recognise both, or a fully
        // pulled blade never gets the "pointer left" signal and never
        // re-seats (R7 bug: this, not timing, is why p-after looked stuck).
        var currentlyPulled = rec.anim.type === 'pointerOut' || rec.anim.type === 'pointerHeld';
        if (within && !currentlyPulled){
          rec.anim = {
            type: 'pointerOut',
            startTime: nowMs,
            duration: 250,
            fromZ: rec.mesh.position.z,
            toZ: rec.restZ + BLADE_D * 0.60,
            fromY: rec.mesh.position.y,
            toY: rec.restY + BLADE_T * 0.4
          };
        } else if (!within && currentlyPulled){
          rec.anim = {
            type: 'pointerIn',
            startTime: nowMs,
            duration: 400, // well under the 1s re-seat ceiling
            fromZ: rec.mesh.position.z,
            toZ: rec.restZ,
            fromY: rec.mesh.position.y,
            toY: rec.restY
          };
        }
      });
    }

    function updatePointerAnims(nowMs){
      blades.forEach(function(rec){
        var a = rec.anim;
        if (a.type !== 'pointerOut' && a.type !== 'pointerIn') return;
        var elapsed = nowMs - a.startTime;
        var t = Math.min(1, elapsed / a.duration);
        var e = easeOutCubic(t);
        rec.mesh.position.z = a.fromZ + (a.toZ - a.fromZ) * e;
        rec.mesh.position.y = a.fromY + (a.toY - a.fromY) * e;
        if (t >= 1){
          rec.anim = { type: a.type === 'pointerOut' ? 'pointerHeld' : 'seated' };
        }
      });
    }

    // Live-loop mirror of the analytic idle-migration used by renderAt:
    // moves one "visiting" blade per cycle, never fighting the pointer or a
    // real failover migration.
    function updateIdleGuest(nowMs){
      if (assemblyStartTime === null) return;
      var migrations = computeIdleMigrations(nowMs - assemblyStartTime);
      blades.forEach(function(rec){
        var idle = findIdleMigrationFor(migrations, rec.colIndex, rec.rowIndex);
        if (!idle){
          if (rec.anim.type === 'idleVisiting'){
            rec.mesh.position.set(0, rec.restY, 0);
            rec.anim = { type: 'seated' };
          }
          return;
        }
        if (rec.anim.type !== 'seated' && rec.anim.type !== 'idleVisiting') return; // don't fight pointer/migration
        var targetX = colXs[idle.dest] - colXs[idle.source];
        var targetY = baseY + ROWS * STEP;
        var half = IDLE_ACTIVE / 2;
        var x, y, t, e, bump;
        if (idle.phaseMs < half){
          t = idle.phaseMs / half; e = easeOutCubic(t);
          bump = Math.sin(Math.min(1, t) * Math.PI) * IDLE_LIFT_BUMP;
          x = targetX * e; y = rec.restY + (targetY - rec.restY) * e + bump;
        } else {
          t = (idle.phaseMs - half) / half; e = easeOutCubic(t);
          bump = Math.sin(Math.min(1, t) * Math.PI) * IDLE_LIFT_BUMP;
          x = targetX * (1 - e); y = targetY + (rec.restY - targetY) * e + bump;
        }
        rec.mesh.position.set(x, y, 0);
        rec.anim = { type: 'idleVisiting' };
      });
    }

    function updateBreathing(nowMs, deltaSec){
      breathT += deltaSec;
      var period = 8;
      var ampDeg = 0.5;
      var angle = Math.sin((breathT / period) * Math.PI * 2) * THREE_REF.MathUtils.degToRad(ampDeg);
      if (scene){
        scene.rotation.y = angle;
      }
    }

    var _boneColor, _darkColor;

    function updatePower(nowMs){
      columns.forEach(function(colRec){
        var elapsed = nowMs - colRec.powerFadeStart;
        var t = Math.min(1, Math.max(0, elapsed / colRec.powerFadeDuration));
        var start = colRec.powerTargetMul === 0 ? 1 : 0;
        var mul = start + (colRec.powerTargetMul - start) * t;
        applyPowerToMaterials(colRec, mul);
      });
    }

    function render(nowMs){
      if (destroyed) return;
      var deltaSec = lastFrameTime ? (nowMs - lastFrameTime) / 1000 : 0;
      lastFrameTime = nowMs;

      updateAssembly(nowMs);
      updateMigration(nowMs);

      if (!reduced){
        if (idlePhase.state === 'stable' && (nowMs - lastFailoverTime) > FAILOVER_INTERVAL){
          startFailover(nowMs);
        }
        updatePointer(nowMs);
        updatePointerAnims(nowMs);
        updateIdleGuest(nowMs);
        updateBreathing(nowMs, deltaSec);
        updatePower(nowMs);
      }

      window.__n5t = (assemblyArmed && assemblyStartTime !== null) ? (nowMs - assemblyStartTime) : -1;

      draw();

      if (!reduced && !livePaused){
        raf = requestAnimationFrame(render);
      }
    }

    function resize(){
      if (!container || !renderer || !camera) return;
      var w = container.clientWidth || 1;
      var h = container.clientHeight || 1;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      if (bloomScene && THREE_REF){
        setupBloomTargets(THREE_REF, renderer.domElement.width, renderer.domElement.height);
      }
      var aspect = w / h;
      var frustumH = 9;
      var isSmall = w <= 767; // stays in lockstep with the CSS phone breakpoint (max-width:767px)
      var frustumW = frustumH * aspect;
      var worldToScreenScale = w / frustumW; // CSS px per world unit at scale 1
      var targetFrac = isSmall ? PORTRAIT_WIDTH_FRAC : 0.36;
      var totalColsWidth = (COLS - 1) * (BLADE_W + COL_GAP) + BLADE_W;
      var scale = (w * targetFrac / worldToScreenScale) / totalColsWidth;
      // The vertical band the object must stay inside. Desktop: the whole
      // viewport (the corners sit at the sides). Phone: between the header's
      // bottom and the clock block's top, read from layout (offsetTop ignores
      // the reveal's translateY). The scale is capped so the object's tallest
      // state fits the band, and the world origin is placed so neither the
      // failover stacks nor the chassis cross the margins.
      var bandTop = 0, bandBot = h, margin = DESKTOP_MARGIN_PX, preferred = h / 2;
      if (isSmall){
        var tlEl = document.querySelector('.tl');
        var blEl = document.querySelector('.bl');
        bandTop = tlEl ? tlEl.offsetTop + tlEl.offsetHeight : h * 0.14;
        bandBot = blEl ? blEl.offsetTop : h * 0.63;
        margin = PORTRAIT_MARGIN_PX;
        preferred = (bandTop + bandBot) / 2 + PORTRAIT_DROP_PX; // Eric: lower than centred
      }
      var bandH = Math.max(1, bandBot - bandTop - 2 * margin);
      var maxScale = bandH / ((HERO_TOP_UNITS + HERO_BOT_UNITS) * worldToScreenScale);
      if (isFinite(maxScale) && maxScale > 0 && maxScale < scale) scale = maxScale;
      var px = scale * worldToScreenScale; // screen px per world unit at this scale
      var originPx = preferred - (HERO_BOT_UNITS - HERO_TOP_UNITS) / 2 * px; // visual centre at `preferred`
      originPx = Math.min(originPx, bandBot - margin - HERO_BOT_UNITS * px);
      originPx = Math.max(originPx, bandTop + margin + HERO_TOP_UNITS * px);
      // shift the frustum, not the scene, so world-space logic (ceiling,
      // lifts) is untouched; positive lift moves the image up
      var liftWorld = (h / 2 - originPx) / worldToScreenScale;
      lastFrame = { w: w, h: h, bandTop: bandTop, bandBot: bandBot, scale: scale, px: px, originPx: originPx, liftWorld: liftWorld, w2s: worldToScreenScale };
      camera.left = -frustumW / 2;
      camera.right = frustumW / 2;
      camera.top = frustumH / 2 - liftWorld;
      camera.bottom = -frustumH / 2 - liftWorld;
      camera.updateProjectionMatrix();
      if (isFinite(scale) && scale > 0){
        scene.scale.setScalar(scale);
      }
    }

    var resizeTimer = null;
    var bandObserver = null; // phone: re-frames when the header / clock block change size (fonts, instrument mount)
    var lastFrame = null;    // debug: the numbers the last resize() framed with
    function onResize(){
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 80);
    }

    function onPointerMove(e){
      pointer.x = e.clientX;
      pointer.y = e.clientY;
    }

    function onVisibilityChange(){
      if (document.hidden){
        if (raf){ cancelAnimationFrame(raf); raf = null; }
      } else if (!reduced && !destroyed && !livePaused) {
        lastFrameTime = 0;
        raf = requestAnimationFrame(render);
      }
    }

    function armAssemblyClock(){
      if (livePaused) return;
      raf = requestAnimationFrame(function(){
        if (livePaused) return;
        raf = requestAnimationFrame(function(ts){
          if (livePaused) return;
          assemblyArmed = true;
          assemblyStartTime = ts;
          lastFrameTime = ts;
          raf = requestAnimationFrame(render);
        });
      });
    }

    function startAnimationLoop(){
      if (destroyed || livePaused) return;
      lastFailoverTime = performance.now();
      armAssemblyClock();
    }

    // Exposed for screenshot tooling: after one or more renderAt(ms) calls,
    // resumeLive() un-pauses and restarts the live experience fresh (real
    // rAF cadence, random failover column, live pointer input) — used
    // before the pointer sweep, which must stay live per spec.
    function resumeLive(){
      if (destroyed) return;
      livePaused = false;
      assemblyArmed = false;
      assemblyStartTime = null;
      lastFrameTime = 0;
      if (failoverTimerId){ clearTimeout(failoverTimerId); failoverTimerId = null; }
      idlePhase.state = 'stable';
      startAnimationLoop();
    }

    function mount(el, opts){
      opts = opts || {};
      var THREE = opts.THREE || window.THREE;
      if (!THREE){
        console.error('N5Hero: THREE (Three.js UMD global) not found on window.');
        return;
      }
      THREE_REF = THREE;
      container = el;
      destroyed = false;

      canvas = document.createElement('canvas');
      canvas.style.display = 'block';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      container.appendChild(canvas);

      var w = container.clientWidth || window.innerWidth;
      var h = container.clientHeight || window.innerHeight;

      renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance'
      });
      renderer.setClearColor(0x000000, 0);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h, false);
      if (SHADOWS_ENABLED){
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      }
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
      else if ('outputEncoding' in renderer) renderer.outputEncoding = THREE.sRGBEncoding;

      buildScene(THREE, w, h);
      buildBloomPipeline(THREE);
      resize();

      mm = window.matchMedia('(prefers-reduced-motion: reduce)');
      reduced = mm.matches;
      if (mm.addEventListener) mm.addEventListener('change', function(ev){
        reduced = ev.matches;
        if (!reduced && !destroyed && !raf && !livePaused){
          lastFrameTime = 0;
          raf = requestAnimationFrame(render);
        }
      });

      window.addEventListener('resize', onResize);
      // the phone framing reads the header/clock block boxes, which grow
      // after mount (odometer build, web fonts) — re-run resize when they do
      if (window.ResizeObserver){
        bandObserver = new ResizeObserver(onResize);
        ['.tl', '.bl'].forEach(function(sel){ var el = document.querySelector(sel); if (el) bandObserver.observe(el); });
      }
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(onResize, function(){});
      window.addEventListener('pointermove', onPointerMove);
      document.addEventListener('visibilitychange', onVisibilityChange);

      if (reduced){
        blades.forEach(function(rec){
          rec.anim = { type: 'seated' };
          rec.mesh.position.y = rec.restY;
          rec.mesh.visible = true;
        });
        draw();
        return;
      }

      draw();

      // Diagnosed bug: if anything calls renderAt() before fonts resolve
      // (e.g. an integration poster-frame render), livePaused stays true
      // forever — startAnimationLoop()/armAssemblyClock() both bail on it,
      // and only an explicit resumeLive() call would ever start the live
      // loop. mount()'s own natural fonts-ready trigger is the authoritative
      // "go live" moment and must not be silently vetoed by an earlier,
      // unrelated renderAt() call — force livePaused false right before it.
      var goLive = function(){ livePaused = false; startAnimationLoop(); };
      if (document.fonts && document.fonts.ready){
        document.fonts.ready.then(goLive);
      } else {
        goLive();
      }
    }

    function setPointer(x, y){
      pointer.x = x;
      pointer.y = y;
    }

    function onState(cb){
      onStateCb = cb;
    }

    function getCamera(){ return camera; }
    function getCanvas(){ return canvas; }

    // Diagnostic only (no behavior change): reports the live pointer state
    // and, for every blade, its current screen position / distance / pull
    // state — so a failure to pull can be diagnosed without guessing.
    function debugPointerState(){
      var rect = canvas ? canvas.getBoundingClientRect() : null;
      var report = { pointer: { x: pointer.x, y: pointer.y }, rect: rect ? { w: rect.width, h: rect.height, l: rect.left, t: rect.top } : null, blades: [] };
      blades.forEach(function(rec){
        var worldPos = new THREE_REF.Vector3();
        rec.mesh.getWorldPosition(worldPos);
        var screenPos = worldPos.clone().project(camera);
        var sx = rect ? (screenPos.x * 0.5 + 0.5) * rect.width + rect.left : null;
        var sy = rect ? (-screenPos.y * 0.5 + 0.5) * rect.height + rect.top : null;
        var dist = (sx !== null && pointer.x !== null) ? Math.sqrt(Math.pow(sx - pointer.x, 2) + Math.pow(sy - pointer.y, 2)) : null;
        report.blades.push({ col: rec.colIndex, row: rec.rowIndex, anim: rec.anim.type, sx: sx, sy: sy, dist: dist, z: rec.mesh.position.z, visible: rec.mesh.visible, matIsArray: Array.isArray(rec.mesh.material), matUuid: Array.isArray(rec.mesh.material) ? rec.mesh.material.map(function(m){return m.uuid;}) : rec.mesh.material.uuid });
      });
      return report;
    }

    function destroy(){
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      if (failoverTimerId) clearTimeout(failoverTimerId);
      window.removeEventListener('resize', onResize);
      if (bandObserver){ bandObserver.disconnect(); bandObserver = null; }
      clearTimeout(resizeTimer);
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (sceneRT) sceneRT.dispose();
      if (brightRT) brightRT.dispose();
      if (blurRT1) blurRT1.dispose();
      if (blurRT2) blurRT2.dispose();
      sceneRT = null; brightRT = null; blurRT1 = null; blurRT2 = null;
      bloomScene = null; bloomCamera = null; quadGeo = null; quadMesh = null;
      brightMat = null; blurMatH = null; blurMatV = null; compositeMat = null;
      if (gapGlowGeo) gapGlowGeo.dispose();
      if (gapGlowMat) gapGlowMat.dispose();
      gapGlowGeo = null; gapGlowMat = null;
      if (renderer){
        renderer.dispose();
      }
      if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
      scene = null; camera = null; renderer = null; canvas = null; container = null;
      blades = []; columns = []; glowLight = null;
    }

    return {
      mount: mount,
      setPointer: setPointer,
      onState: onState,
      renderAt: renderAt,
      resumeLive: resumeLive,
      _getCamera: getCamera,
      _getCanvas: getCanvas,
      _debugPointerState: debugPointerState,
      _debugFrame: function(){ return lastFrame; },
      _forceRender: function(){ draw(); },
      destroy: destroy
    };
  }

  window.N5Hero = N5HeroImpl();
})();
