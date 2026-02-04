import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader, type GLTF, type GLTFParser } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";

export type ExpressionLabel = "neutral" | "happy" | "sad" | "surprised";

type VrmAvatarProps = {
  vrmUrl: string;
  expression: ExpressionLabel;
  mouthOpen: number;
};

const resetExpressions = (vrm: VRM) => {
  const manager = vrm.expressionManager;
  if (!manager) {
    return;
  }

  manager.setValue("happy", 0);
  manager.setValue("sad", 0);
  manager.setValue("surprised", 0);
};

const applyExpression = (vrm: VRM, expression: ExpressionLabel) => {
  const manager = vrm.expressionManager;
  if (!manager) {
    return;
  }

  resetExpressions(vrm);
  if (expression === "neutral") {
    return;
  }
  manager.setValue(expression, 1);
};

const applyMouthOpen = (vrm: VRM, mouthOpen: number) => {
  const manager = vrm.expressionManager;
  if (!manager) {
    return;
  }

  manager.setValue("aa", Math.min(1, Math.max(0, mouthOpen)));
};

const isWebGlAvailable = () => {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    return Boolean(gl);
  } catch {
    return false;
  }
};

export const VrmAvatar = ({ vrmUrl, expression, mouthOpen }: VrmAvatarProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isWebGlOk = useMemo(() => isWebGlAvailable(), []);

  const expressionRef = useRef<ExpressionLabel>(expression);
  const mouthOpenRef = useRef<number>(mouthOpen);

  useEffect(() => {
    expressionRef.current = expression;
  }, [expression]);

  useEffect(() => {
    mouthOpenRef.current = mouthOpen;
  }, [mouthOpen]);

  useEffect(() => {
    if (!vrmUrl) {
      setError("VRM model is not configured");
      return;
    }

    if (!isWebGlOk) {
      setError("WebGL is not available");
      return;
    }

    const container = containerRef.current!;

    setError(null);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#efe7d8");

    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, 1.35, 2.4);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x3b2f2a, 1.0);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(1, 3, 2);
    scene.add(dir);

    let rafId = 0;
    const clock = new THREE.Clock();
    let vrm: VRM | null = null;
    let isDisposed = false;

    const onResize = () => resize();

    const disposeRuntime = () => {
      if (isDisposed) {
        return;
      }
      isDisposed = true;
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(rafId);

      if (vrm) {
        try {
          VRMUtils.deepDispose(vrm.scene);
        } catch {
          // ignore
        }
      }

      try {
        renderer.dispose();
      } catch {
        // ignore
      }

      try {
        container.removeChild(renderer.domElement);
      } catch {
        // ignore
      }
    };

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    resize();

    window.addEventListener("resize", onResize);

    const loader = new GLTFLoader();
    loader.register((parser: GLTFParser) => new VRMLoaderPlugin(parser));

    void loader
      .loadAsync(vrmUrl)
      .then((gltf: GLTF) => {
        if (isDisposed) {
          return;
        }
        const loaded = (gltf.userData as Record<string, unknown>).vrm as VRM | undefined;
        if (!loaded) {
          setError("Failed to load VRM");
          disposeRuntime();
          return;
        }

        vrm = loaded;

        VRMUtils.removeUnnecessaryVertices(vrm.scene);
        VRMUtils.removeUnnecessaryJoints(vrm.scene);
        VRMUtils.rotateVRM0(vrm);

        scene.add(vrm.scene);
      })
      .catch((e: unknown) => {
        if (isDisposed) {
          return;
        }
        setError(e instanceof Error ? e.message : "Failed to load VRM");
        disposeRuntime();
      });

    const animate = () => {
      if (isDisposed) {
        return;
      }
      rafId = requestAnimationFrame(animate);
      const delta = clock.getDelta();

      if (vrm) {
        applyExpression(vrm, expressionRef.current);
        applyMouthOpen(vrm, mouthOpenRef.current);
        vrm.update(delta);
      }

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      disposeRuntime();
    };
  }, [vrmUrl, isWebGlOk]);

  if (error) {
    return (
      <div
        data-testid="mascot-stage-fallback"
        style={{
          height: "100%",
          width: "100%",
          display: "grid",
          placeItems: "center",
          borderRadius: 20,
          border: "1px dashed rgba(43, 36, 29, 0.35)",
          background: "rgba(255, 255, 255, 0.6)",
          color: "#2b241d",
          fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
          padding: 16,
          textAlign: "center",
        }}
      >
        <div>
          <div style={{ fontWeight: 700 }}>Mascot Stage</div>
          <div style={{ fontSize: 12, marginTop: 6 }}>VRM is not available ({error})</div>
        </div>
      </div>
    );
  }

  return <div ref={containerRef} style={{ height: "100%", width: "100%" }} />;
};

export const __test__ = {
  resetExpressions,
  applyExpression,
  applyMouthOpen,
  isWebGlAvailable,
};
