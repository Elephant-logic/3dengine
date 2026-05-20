// ─────────────────────────────────────────────────────────────────────────────
// PHONG LIT — standard Blinn-Phong shading with up to 4 point lights
// ─────────────────────────────────────────────────────────────────────────────
export const PHONG_VERT = `#version 300 es
precision highp float;

layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUV;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;
uniform mat4 uNormalMatrix; // transpose(inverse(uModel))

out vec3 vWorldPos;
out vec3 vNormal;
out vec2 vUV;

void main(){
  vec4 world = uModel * vec4(aPos, 1.0);
  vWorldPos   = world.xyz;
  vNormal     = normalize((uNormalMatrix * vec4(aNormal, 0.0)).xyz);
  vUV         = aUV;
  gl_Position = uProj * uView * world;
}
`;

export const PHONG_FRAG = `#version 300 es
precision highp float;

in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vUV;

// Material
uniform vec4  uColour;       // base colour
uniform float uShininess;    // specular exponent
uniform float uMetallic;     // 0=dielectric 1=metal
uniform float uRoughness;    // affects specular spread
uniform bool  uHasTexture;
uniform sampler2D uTexture;

// Lighting
uniform vec3  uCamPos;
uniform vec3  uAmbient;      // ambient colour * intensity
uniform vec3  uSunDir;       // normalised toward sun
uniform vec3  uSunColour;
uniform float uSunIntensity;

// Point lights (up to 4)
uniform int   uNumLights;
uniform vec3  uLightPos[4];
uniform vec3  uLightColour[4];
uniform float uLightRadius[4];

out vec4 fragColour;

vec3 blinnPhong(vec3 lightDir, vec3 lightColour, float attenuation,
                vec3 N, vec3 V, vec3 baseColour){
  float NdotL = max(dot(N, lightDir), 0.0);
  vec3 H      = normalize(lightDir + V);
  float spec  = pow(max(dot(N, H), 0.0), uShininess*(1.0-uRoughness)+1.0);
  vec3 diffuse  = baseColour * lightColour * NdotL;
  vec3 specular = mix(vec3(0.04), baseColour, uMetallic) * lightColour * spec;
  return (diffuse + specular) * attenuation;
}

void main(){
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorldPos);

  vec4 texCol = uHasTexture ? texture(uTexture, vUV) : vec4(1.0);
  vec3 base   = uColour.rgb * texCol.rgb;
  float alpha = uColour.a  * texCol.a;

  // Ambient
  vec3 colour = uAmbient * base;

  // Directional sun
  colour += blinnPhong(normalize(uSunDir), uSunColour, uSunIntensity, N, V, base);

  // Point lights
  for(int i=0; i<4; i++){
    if(i>=uNumLights) break;
    vec3  diff = uLightPos[i] - vWorldPos;
    float dist = length(diff);
    float att  = max(0.0, 1.0 - dist/uLightRadius[i]);
    att *= att;
    colour += blinnPhong(normalize(diff), uLightColour[i], att, N, V, base);
  }

  fragColour = vec4(colour, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// UNLIT — flat colour / texture, no lighting
// ─────────────────────────────────────────────────────────────────────────────
export const UNLIT_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=2) in vec2 aUV;
uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;
out vec2 vUV;
void main(){
  vUV = aUV;
  gl_Position = uProj * uView * uModel * vec4(aPos, 1.0);
}
`;

export const UNLIT_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
uniform vec4 uColour;
uniform bool uHasTexture;
uniform sampler2D uTexture;
out vec4 fragColour;
void main(){
  vec4 tex = uHasTexture ? texture(uTexture, vUV) : vec4(1.0);
  fragColour = uColour * tex;
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// SKYBOX — renders a solid gradient sky (no cubemap needed)
// ─────────────────────────────────────────────────────────────────────────────
export const SKY_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
uniform mat4 uView;
uniform mat4 uProj;
out vec3 vDir;
void main(){
  vDir = aPos;
  mat4 v = uView;
  v[3] = vec4(0,0,0,1); // remove translation
  vec4 pos = uProj * v * vec4(aPos * 500.0, 1.0);
  gl_Position = pos.xyww; // keep at max depth
}
`;

export const SKY_FRAG = `#version 300 es
precision highp float;
in vec3 vDir;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyBottom;
out vec4 fragColour;
void main(){
  float t = clamp(normalize(vDir).y, -1.0, 1.0);
  vec3 sky = t > 0.0
    ? mix(uSkyHorizon, uSkyTop,    pow(t,   0.5))
    : mix(uSkyHorizon, uSkyBottom, pow(-t,  0.5));
  fragColour = vec4(sky, 1.0);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// DEBUG WIREFRAME — overlay wireframe lines (no depth test, additive blend)
// ─────────────────────────────────────────────────────────────────────────────
export const DEBUG_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
uniform mat4 uVP; // combined view-projection
uniform mat4 uModel;
void main(){
  gl_Position = uVP * uModel * vec4(aPos, 1.0);
}
`;

export const DEBUG_FRAG = `#version 300 es
precision highp float;
uniform vec4 uColour;
out vec4 fragColour;
void main(){ fragColour = uColour; }
`;

// ─────────────────────────────────────────────────────────────────────────────
// SHADOW MAP — simple depth-only pass
// ─────────────────────────────────────────────────────────────────────────────
export const SHADOW_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
uniform mat4 uLightVP;
uniform mat4 uModel;
void main(){ gl_Position = uLightVP * uModel * vec4(aPos, 1.0); }
`;

export const SHADOW_FRAG = `#version 300 es
precision highp float;
out vec4 fragColour;
void main(){ fragColour = vec4(gl_FragCoord.z, 0.0, 0.0, 1.0); }
`;
