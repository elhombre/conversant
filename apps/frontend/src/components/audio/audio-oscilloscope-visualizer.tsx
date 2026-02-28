'use client'

import { Canvas, useFrame } from '@react-three/fiber'
import type { CSSProperties, RefObject } from 'react'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { cn } from '@/lib/utils'

type AudioDataRefs = {
  audioLevelRef: RefObject<number>
  freqDataRef: RefObject<Uint8Array>
}

export type AudioOscilloscopeVisualizerProps = {
  analyser: AnalyserNode | null
  isActive: boolean
  className?: string
  style?: CSSProperties
  distortion?: number
  rotationSpeed?: number
  idleRotationSpeed?: number
  audioReactivity?: number
  meshResolution?: number
  haloResolution?: number
  wireframeOpacity?: number
  backWireOpacity?: number
  haloStrength?: number
  lineAmplitude?: number
  lineCount?: number
  linePoints?: number
  lineTemporalSmoothing?: number
  lineSpatialSmoothingPasses?: number
  showIdleRings?: boolean
  freezeWhenInactive?: boolean
  dpr?: [number, number]
  cameraZ?: number
}

const DEFAULTS = {
  distortion: 1,
  rotationSpeed: 0.13,
  idleRotationSpeed: 0.015,
  audioReactivity: 1,
  meshResolution: 3,
  haloResolution: 72,
  wireframeOpacity: 0.5,
  backWireOpacity: 0.3,
  haloStrength: 1,
  lineAmplitude: 67,
  lineCount: 3,
  linePoints: 220,
  lineTemporalSmoothing: 0.18,
  lineSpatialSmoothingPasses: 2,
  showIdleRings: true,
  dpr: [1, 2] as [number, number],
  cameraZ: 7.1,
}

const SIMPLEX_NOISE = `
vec3 mod289(vec3 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 mod289(vec4 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 permute(vec4 x) {
  return mod289(((x * 34.0) + 10.0) * x);
}

vec4 taylorInvSqrt(vec4 r) {
  return 1.79284291400159 - 0.85373472095314 * r;
}

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 1.0 / 7.0;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function sampleSmoothedFrequency(data: Uint8Array, center: number): number {
  const length = data.length
  if (length === 0) {
    return 0
  }

  let sum = 0
  let count = 0

  for (let offset = -2; offset <= 2; offset += 1) {
    const index = (center + offset + length) % length
    sum += data[index]
    count += 1
  }

  return sum / count / 255
}

function sampleBandEnergy(data: Uint8Array, start: number, length: number): number {
  if (data.length === 0 || length <= 0) {
    return 0
  }

  let sum = 0
  for (let i = 0; i < length; i += 1) {
    const index = (start + i) % data.length
    sum += data[index]
  }

  return sum / length / 255
}

function smoothCircular(values: number[], passes: number): number[] {
  let source = values.slice()
  let target = new Array<number>(values.length)

  for (let pass = 0; pass < passes; pass += 1) {
    for (let i = 0; i < source.length; i += 1) {
      const prev = source[(i - 1 + source.length) % source.length]
      const curr = source[i]
      const next = source[(i + 1) % source.length]
      target[i] = prev * 0.25 + curr * 0.5 + next * 0.25
    }
    ;[source, target] = [target, source]
  }

  return source
}

function useAnalyserData(analyser: AnalyserNode | null, isActive: boolean, audioReactivity: number): AudioDataRefs {
  const audioLevelRef = useRef(0)
  const freqDataRef = useRef(new Uint8Array(512))
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (!analyser || !isActive) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      audioLevelRef.current = 0
      freqDataRef.current.fill(0)
      return
    }

    const size = analyser.frequencyBinCount
    const timeData = new Uint8Array(size)
    freqDataRef.current = new Uint8Array(size)

    const tick = () => {
      analyser.getByteTimeDomainData(timeData)
      analyser.getByteFrequencyData(freqDataRef.current)

      let sum = 0
      for (let i = 0; i < timeData.length; i += 1) {
        const centered = (timeData[i] - 128) / 128
        sum += centered * centered
      }

      const rms = Math.sqrt(sum / timeData.length)
      const raw = clamp(rms * 3.5 * audioReactivity, 0, 1)
      audioLevelRef.current = THREE.MathUtils.lerp(audioLevelRef.current, raw, 0.12)

      rafRef.current = requestAnimationFrame(tick)
    }

    tick()

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [analyser, audioReactivity, isActive])

  return { audioLevelRef, freqDataRef }
}

type BlobProps = {
  audioLevelRef: RefObject<number>
  isActive: boolean
  freezeWhenInactive: boolean
  distortion: number
  rotationSpeed: number
  idleRotationSpeed: number
  audioReactivity: number
  meshResolution: number
  haloResolution: number
  wireframeOpacity: number
  backWireOpacity: number
  haloStrength: number
}

function BlobMesh({
  audioLevelRef,
  isActive,
  freezeWhenInactive,
  distortion,
  rotationSpeed,
  idleRotationSpeed,
  audioReactivity,
  meshResolution,
  haloResolution,
  wireframeOpacity,
  backWireOpacity,
  haloStrength,
}: BlobProps) {
  const groupRef = useRef<THREE.Group>(null)
  const visualTimeRef = useRef(0)
  const rotationYRef = useRef(0)
  const smoothLevelRef = useRef(0)

  const detail = clamp(Math.round(meshResolution), 0, 6)
  const haloSegments = clamp(Math.round(haloResolution), 16, 128)

  const coreFrontMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        audioLevel: { value: 0 },
        distortion: { value: distortion },
      },
      vertexShader: `
        uniform float time;
        uniform float audioLevel;
        uniform float distortion;

        varying vec3 vNormal;

        ${SIMPLEX_NOISE}

        void main() {
          float slowTime = time * 0.32;
          float n = snoise(normal * 2.2 + vec3(slowTime));
          float pulse = 0.06 + audioLevel * 0.22;

          vec3 transformed = position;
          transformed *= 1.0 + n * 0.09 * distortion + pulse * (0.7 + distortion * 0.3);

          gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
          vNormal = normalize(normalMatrix * normal);
        }
      `,
      fragmentShader: `
        uniform float audioLevel;
        varying vec3 vNormal;

        void main() {
          float fresnel = pow(0.75 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.15);
          vec3 baseColor = mix(vec3(0.43, 1.0, 0.72), vec3(0.75, 1.0, 0.88), audioLevel);
          vec3 color = baseColor * fresnel * (0.86 + audioLevel * 2.0);
          gl_FragColor = vec4(color, ${wireframeOpacity.toFixed(3)});
        }
      `,
      wireframe: true,
      side: THREE.FrontSide,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
  }, [distortion, wireframeOpacity])

  const coreBackMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        audioLevel: { value: 0 },
        distortion: { value: distortion },
      },
      vertexShader: `
        uniform float time;
        uniform float audioLevel;
        uniform float distortion;

        varying vec3 vNormal;

        ${SIMPLEX_NOISE}

        void main() {
          float slowTime = time * 0.32;
          float n = snoise(normal * 2.2 + vec3(slowTime));
          float pulse = 0.06 + audioLevel * 0.22;

          vec3 transformed = position;
          transformed *= 1.0 + n * 0.09 * distortion + pulse * (0.7 + distortion * 0.3);

          gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
          vNormal = normalize(normalMatrix * normal);
        }
      `,
      fragmentShader: `
        uniform float audioLevel;
        varying vec3 vNormal;

        void main() {
          float fresnel = pow(0.75 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.15);
          vec3 baseColor = mix(vec3(0.03, 0.07, 0.05), vec3(0.07, 0.14, 0.1), audioLevel);
          vec3 color = baseColor * (0.65 + fresnel * 0.35);
          gl_FragColor = vec4(color, ${backWireOpacity.toFixed(3)});
        }
      `,
      wireframe: true,
      side: THREE.BackSide,
      transparent: true,
      depthTest: true,
      depthWrite: false,
    })
  }, [backWireOpacity, distortion])

  const auraMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        audioLevel: { value: 0 },
        distortion: { value: distortion },
        haloStrength: { value: haloStrength },
      },
      vertexShader: `
        uniform float time;
        uniform float audioLevel;
        uniform float distortion;
        uniform float haloStrength;

        varying vec3 vNormal;

        ${SIMPLEX_NOISE}

        void main() {
          float haloTime = time * 0.24;
          float irregularA = snoise(position * 0.95 + vec3(haloTime));
          float irregularB = snoise(normal * 1.7 - vec3(haloTime * 0.7));
          float irregular = (irregularA * 0.08 + irregularB * 0.05) * distortion;

          vec3 transformed = position;
          transformed *= 1.1 + irregular + audioLevel * 0.19 * haloStrength;

          gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
          vNormal = normalize(normalMatrix * normal);
        }
      `,
      fragmentShader: `
        uniform float audioLevel;
        uniform float haloStrength;
        varying vec3 vNormal;

        void main() {
          float edge = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 2.45);
          vec3 color = mix(vec3(0.20, 0.95, 0.62), vec3(0.78, 1.0, 0.90), audioLevel);
          gl_FragColor = vec4(color * edge, (0.24 + audioLevel * 0.28) * haloStrength);
        }
      `,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
    })
  }, [distortion, haloStrength])

  useEffect(() => {
    return () => {
      coreFrontMaterial.dispose()
      coreBackMaterial.dispose()
      auraMaterial.dispose()
    }
  }, [auraMaterial, coreBackMaterial, coreFrontMaterial])

  useFrame((_, delta) => {
    if (!isActive && freezeWhenInactive) {
      return
    }

    const safeRotation = Math.max(0, rotationSpeed)
    const safeIdleRotation = Math.max(0, idleRotationSpeed)
    const inputLevel = isActive ? audioLevelRef.current : 0
    const reactivityBoost = clamp(audioReactivity, 0.2, 2.5)
    const adjustedLevel = inputLevel * reactivityBoost
    const levelLerp = isActive ? 0.1 : 0.04

    smoothLevelRef.current = THREE.MathUtils.lerp(smoothLevelRef.current, adjustedLevel, levelLerp)

    visualTimeRef.current += delta * ((isActive ? 0.7 : 0.08) + smoothLevelRef.current * 0.75)
    rotationYRef.current += delta * ((isActive ? safeRotation : safeIdleRotation) + smoothLevelRef.current * 0.5)

    coreFrontMaterial.uniforms.time.value = visualTimeRef.current
    coreFrontMaterial.uniforms.audioLevel.value = THREE.MathUtils.lerp(
      coreFrontMaterial.uniforms.audioLevel.value,
      smoothLevelRef.current,
      0.1,
    )

    coreBackMaterial.uniforms.time.value = visualTimeRef.current
    coreBackMaterial.uniforms.audioLevel.value = THREE.MathUtils.lerp(
      coreBackMaterial.uniforms.audioLevel.value,
      smoothLevelRef.current,
      0.1,
    )

    auraMaterial.uniforms.time.value = visualTimeRef.current
    auraMaterial.uniforms.audioLevel.value = THREE.MathUtils.lerp(
      auraMaterial.uniforms.audioLevel.value,
      smoothLevelRef.current,
      0.08,
    )

    if (groupRef.current) {
      groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, rotationYRef.current, 0.08)

      const idleAmplitude = isActive ? 0.08 : 0.014
      const targetX = Math.sin(visualTimeRef.current * 0.42) * idleAmplitude * (0.4 + smoothLevelRef.current)
      groupRef.current.rotation.x = THREE.MathUtils.lerp(groupRef.current.rotation.x, targetX, 0.06)

      const targetScale = 1 + smoothLevelRef.current * 0.08
      const nextScale = THREE.MathUtils.lerp(groupRef.current.scale.x, targetScale, 0.08)
      groupRef.current.scale.setScalar(nextScale)
    }
  })

  return (
    <group ref={groupRef}>
      <mesh renderOrder={1}>
        <icosahedronGeometry args={[2.05, detail]} />
        <primitive object={coreBackMaterial} attach="material" />
      </mesh>

      <mesh renderOrder={2}>
        <icosahedronGeometry args={[2.05, detail]} />
        <primitive object={coreFrontMaterial} attach="material" />
      </mesh>

      <mesh scale={1.24}>
        <sphereGeometry args={[2.05, haloSegments, haloSegments]} />
        <primitive object={auraMaterial} attach="material" />
      </mesh>
    </group>
  )
}

type LinesProps = {
  freqDataRef: RefObject<Uint8Array>
  isActive: boolean
  lineCount: number
  linePoints: number
  lineAmplitude: number
  lineTemporalSmoothing: number
  lineSpatialSmoothingPasses: number
  showIdleRings: boolean
}

function ScreenLines({
  freqDataRef,
  isActive,
  lineCount,
  linePoints,
  lineAmplitude,
  lineTemporalSmoothing,
  lineSpatialSmoothingPasses,
  showIdleRings,
}: LinesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const radiiHistoryRef = useRef<number[][]>([])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    const context = canvas.getContext('2d')
    if (!context) {
      return
    }

    const safeLineCount = clamp(Math.round(lineCount), 1, 6)
    const safeLinePoints = clamp(Math.round(linePoints), 48, 512)
    const temporalLerp = clamp(lineTemporalSmoothing, 0.02, 0.8)
    const smoothingPasses = clamp(Math.round(lineSpatialSmoothingPasses), 0, 6)

    const resize = () => {
      const parent = canvas.parentElement
      if (!parent) {
        return
      }
      canvas.width = parent.clientWidth
      canvas.height = parent.clientHeight
    }

    const drawStaticRings = () => {
      if (!showIdleRings) {
        context.clearRect(0, 0, canvas.width, canvas.height)
        return
      }

      const width = canvas.width
      const height = canvas.height
      const centerX = width * 0.5
      const centerY = height * 0.5
      const baseRadius = Math.min(width, height) * 0.255

      context.clearRect(0, 0, width, height)

      for (let ring = 0; ring < safeLineCount; ring += 1) {
        const ringScale = 1 + ring * 0.24
        const ringRadius = baseRadius * ringScale

        context.beginPath()
        context.arc(centerX, centerY, ringRadius, 0, Math.PI * 2)
        context.closePath()

        context.strokeStyle = `rgba(134, 255, 205, ${Math.max(0.1, 0.36 - ring * 0.08)})`
        context.lineWidth = Math.max(1.15, 2.8 - ring * 0.6)
        context.shadowColor = 'rgba(100, 255, 190, 0.35)'
        context.shadowBlur = 8 + ring * 2
        context.stroke()
      }
    }

    resize()

    if (!isActive) {
      drawStaticRings()

      const onResize = () => {
        resize()
        drawStaticRings()
      }

      window.addEventListener('resize', onResize)

      return () => {
        window.removeEventListener('resize', onResize)
      }
    }

    const onResize = () => {
      resize()
      context.clearRect(0, 0, canvas.width, canvas.height)
    }

    window.addEventListener('resize', onResize)

    let animationFrame = 0

    const render = () => {
      const width = canvas.width
      const height = canvas.height
      const centerX = width * 0.5
      const centerY = height * 0.5
      const baseRadius = Math.min(width, height) * 0.255
      const frequencyData = freqDataRef.current
      const dataLength = frequencyData.length

      context.clearRect(0, 0, width, height)

      if (dataLength > 0) {
        const globalEnergy = sampleBandEnergy(frequencyData, 0, dataLength)

        for (let ring = 0; ring < safeLineCount; ring += 1) {
          const elapsed = performance.now() * 0.001
          const ringScale = 1 + ring * 0.24
          const ringRadius = baseRadius * ringScale
          const amplitude = (lineAmplitude * (1 - ring * 0.12)) / ringScale
          const strokeAlpha = 0.36 - ring * 0.08
          const offset = elapsed * (1.15 + ring * 0.32) * dataLength * 0.08
          const radii = new Array<number>(safeLinePoints)
          const history = radiiHistoryRef.current[ring] ?? new Array<number>(safeLinePoints).fill(ringRadius)
          radiiHistoryRef.current[ring] = history

          for (let i = 0; i < safeLinePoints; i += 1) {
            const raw = Math.floor((i / safeLinePoints) * dataLength + offset + ring * 17)
            const bin = ((raw % dataLength) + dataLength) % dataLength
            const local = sampleSmoothedFrequency(frequencyData, bin)
            const blended = Math.min(1, local * 0.58 + globalEnergy * 0.42)
            const target = ringRadius + blended * amplitude
            history[i] = history[i] + (target - history[i]) * temporalLerp
            radii[i] = history[i]
          }

          const smoothedRadii = smoothCircular(radii, smoothingPasses)
          const points = new Array<{ x: number; y: number }>(safeLinePoints)

          for (let i = 0; i < safeLinePoints; i += 1) {
            const angle = (i / safeLinePoints) * Math.PI * 2
            const dynamicRadius = smoothedRadii[i]
            const x = centerX + Math.cos(angle) * dynamicRadius
            const y = centerY + Math.sin(angle) * dynamicRadius
            points[i] = { x, y }
          }

          context.beginPath()
          context.lineJoin = 'round'
          context.lineCap = 'round'
          const startMidX = (points[0].x + points[1].x) * 0.5
          const startMidY = (points[0].y + points[1].y) * 0.5
          context.moveTo(startMidX, startMidY)

          for (let i = 1; i <= safeLinePoints; i += 1) {
            const current = points[i % safeLinePoints]
            const next = points[(i + 1) % safeLinePoints]
            const midX = (current.x + next.x) * 0.5
            const midY = (current.y + next.y) * 0.5
            context.quadraticCurveTo(current.x, current.y, midX, midY)
          }

          context.closePath()
          context.strokeStyle = `rgba(134, 255, 205, ${Math.max(0.08, strokeAlpha)})`
          context.lineWidth = Math.max(1.15, 2.8 - ring * 0.6)
          context.shadowColor = 'rgba(100, 255, 190, 0.45)'
          context.shadowBlur = 9 + ring * 3
          context.stroke()
        }
      }

      animationFrame = requestAnimationFrame(render)
    }

    render()

    return () => {
      cancelAnimationFrame(animationFrame)
      context.clearRect(0, 0, canvas.width, canvas.height)
      window.removeEventListener('resize', onResize)
    }
  }, [
    freqDataRef,
    isActive,
    lineAmplitude,
    lineCount,
    linePoints,
    lineSpatialSmoothingPasses,
    lineTemporalSmoothing,
    showIdleRings,
  ])

  return <canvas className="pointer-events-none absolute inset-0 z-10 mix-blend-screen" ref={canvasRef} />
}

export default function AudioOscilloscopeVisualizer(props: AudioOscilloscopeVisualizerProps) {
  const {
    analyser,
    isActive,
    className,
    style,
    distortion = DEFAULTS.distortion,
    rotationSpeed = DEFAULTS.rotationSpeed,
    idleRotationSpeed = DEFAULTS.idleRotationSpeed,
    audioReactivity = DEFAULTS.audioReactivity,
    meshResolution = DEFAULTS.meshResolution,
    haloResolution = DEFAULTS.haloResolution,
    wireframeOpacity = DEFAULTS.wireframeOpacity,
    backWireOpacity = DEFAULTS.backWireOpacity,
    haloStrength = DEFAULTS.haloStrength,
    lineAmplitude = DEFAULTS.lineAmplitude,
    lineCount = DEFAULTS.lineCount,
    linePoints = DEFAULTS.linePoints,
    lineTemporalSmoothing = DEFAULTS.lineTemporalSmoothing,
    lineSpatialSmoothingPasses = DEFAULTS.lineSpatialSmoothingPasses,
    showIdleRings = DEFAULTS.showIdleRings,
    freezeWhenInactive = false,
    dpr = DEFAULTS.dpr,
    cameraZ = DEFAULTS.cameraZ,
  } = props

  const { audioLevelRef, freqDataRef } = useAnalyserData(analyser, isActive, audioReactivity)

  return (
    <div className={cn('relative h-full w-full', className)} style={style}>
      <Canvas camera={{ position: [0, 0, cameraZ], fov: 52 }} dpr={dpr}>
        <ambientLight intensity={0.28} />
        <pointLight position={[4, 4, 5]} intensity={2.45} color="#7fffb9" />
        <pointLight position={[-4, -2, 4]} intensity={1.7} color="#3cf4a0" />
        <BlobMesh
          audioLevelRef={audioLevelRef}
          isActive={isActive}
          freezeWhenInactive={freezeWhenInactive}
          distortion={distortion}
          rotationSpeed={rotationSpeed}
          idleRotationSpeed={idleRotationSpeed}
          audioReactivity={audioReactivity}
          meshResolution={meshResolution}
          haloResolution={haloResolution}
          wireframeOpacity={wireframeOpacity}
          backWireOpacity={backWireOpacity}
          haloStrength={haloStrength}
        />
      </Canvas>

      <ScreenLines
        freqDataRef={freqDataRef}
        isActive={isActive}
        lineCount={lineCount}
        linePoints={linePoints}
        lineAmplitude={lineAmplitude}
        lineTemporalSmoothing={lineTemporalSmoothing}
        lineSpatialSmoothingPasses={lineSpatialSmoothingPasses}
        showIdleRings={showIdleRings}
      />
    </div>
  )
}
