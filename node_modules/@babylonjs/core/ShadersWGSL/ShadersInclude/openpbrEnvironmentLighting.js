// Do not edit.
import { ShaderStore } from "../../Engines/shaderStore.js";
const name = "openpbrEnvironmentLighting";
const shader = `#ifdef REFLECTION
#ifdef FUZZ
let environmentFuzzBrdf: vec3f=getFuzzBRDFLookup(fuzzGeoInfo.NdotV,sqrt(fuzz_roughness));
#endif
var baseDiffuseEnvironmentLight: vec3f=sampleIrradiance(
normalW
#if defined(NORMAL) && defined(USESPHERICALINVERTEX)
,vEnvironmentIrradiance 
#endif
#if (defined(USESPHERICALFROMREFLECTIONMAP) && (!defined(NORMAL) || !defined(USESPHERICALINVERTEX))) || (defined(USEIRRADIANCEMAP) && defined(REFLECTIONMAP_3D))
,uniforms.reflectionMatrix
#endif
#ifdef USEIRRADIANCEMAP
,irradianceSampler
,irradianceSamplerSampler
#ifdef USE_IRRADIANCE_DOMINANT_DIRECTION
,uniforms.vReflectionDominantDirection
#endif
#endif
#ifdef REALTIME_FILTERING
,uniforms.vReflectionFilteringInfo
#ifdef IBL_CDF_FILTERING
,icdfSampler
,icdfSamplerSampler
#endif
#endif
,uniforms.vReflectionInfos
,viewDirectionW
,base_diffuse_roughness
,base_color
);
#ifdef REFLECTIONMAP_3D
var reflectionCoords: vec3f=vec3f(0.f,0.f,0.f);
#else
var reflectionCoords: vec2f=vec2f(0.f,0.f);
#endif
let specularAlphaG: f32=specular_roughness*specular_roughness;
#ifdef ANISOTROPIC_BASE
var baseSpecularEnvironmentLight: vec3f=sampleRadianceAnisotropic(specularAlphaG,uniforms.vReflectionMicrosurfaceInfos.rgb,uniforms.vReflectionInfos
,baseGeoInfo
,normalW
,viewDirectionW
,fragmentInputs.vPositionW
,noise
,reflectionSampler
,reflectionSamplerSampler
#ifdef REALTIME_FILTERING
,uniforms.vReflectionFilteringInfo
#endif
);
#else
reflectionCoords=createReflectionCoords(fragmentInputs.vPositionW,normalW);var baseSpecularEnvironmentLight: vec3f=sampleRadiance(specularAlphaG,uniforms.vReflectionMicrosurfaceInfos.rgb,uniforms.vReflectionInfos
,baseGeoInfo
,reflectionSampler
,reflectionSamplerSampler
,reflectionCoords
#ifdef REALTIME_FILTERING
,uniforms.vReflectionFilteringInfo
#endif
);
#endif
#ifdef ANISOTROPIC_BASE
baseSpecularEnvironmentLight=mix(baseSpecularEnvironmentLight.rgb,baseDiffuseEnvironmentLight,specularAlphaG*specularAlphaG *max(1.0f-baseGeoInfo.anisotropy,0.3f));
#else
baseSpecularEnvironmentLight=mix(baseSpecularEnvironmentLight.rgb,baseDiffuseEnvironmentLight,specularAlphaG);
#endif
var coatEnvironmentLight: vec3f=vec3f(0.f,0.f,0.f);if (coat_weight>0.0) {
#ifdef REFLECTIONMAP_3D
var reflectionCoords: vec3f=vec3f(0.f,0.f,0.f);
#else
var reflectionCoords: vec2f=vec2f(0.f,0.f);
#endif
reflectionCoords=createReflectionCoords(fragmentInputs.vPositionW,coatNormalW);var coatAlphaG: f32=coat_roughness*coat_roughness;
#ifdef ANISOTROPIC_COAT
coatEnvironmentLight=sampleRadianceAnisotropic(coatAlphaG,uniforms.vReflectionMicrosurfaceInfos.rgb,uniforms.vReflectionInfos
,coatGeoInfo
,coatNormalW
,viewDirectionW
,fragmentInputs.vPositionW
,noise
,reflectionSampler
,reflectionSamplerSampler
#ifdef REALTIME_FILTERING
,uniforms.vReflectionFilteringInfo
#endif
);
#else
coatEnvironmentLight=sampleRadiance(coatAlphaG,uniforms.vReflectionMicrosurfaceInfos.rgb,uniforms.vReflectionInfos
,coatGeoInfo
,reflectionSampler
,reflectionSamplerSampler
,reflectionCoords
#ifdef REALTIME_FILTERING
,uniforms.vReflectionFilteringInfo
#endif
);
#endif
}
#ifdef FUZZ
let modifiedFuzzRoughness: f32=clamp(fuzz_roughness*(1.0f-0.5f*environmentFuzzBrdf.y),0.0f,1.0f);var fuzzEnvironmentLight=vec3f(0.0f,0.0f,0.0f);var totalWeight=0.0f;let fuzzIblFresnel: f32=sqrt(environmentFuzzBrdf.z);for (var i: i32=0; i<i32(FUZZ_IBL_SAMPLES); i++) {var angle: f32=(f32(i)+noise.x)*(3.141592f*2.0f/f32(FUZZ_IBL_SAMPLES));var fiberCylinderNormal: vec3f=normalize(cos(angle)*fuzzTangent+sin(angle)*fuzzBitangent);let fiberBend=min(environmentFuzzBrdf.x*environmentFuzzBrdf.x*modifiedFuzzRoughness,1.0f);fiberCylinderNormal=normalize(mix(fiberCylinderNormal,fuzzNormalW,fiberBend));let sampleWeight=max(dot(viewDirectionW,fiberCylinderNormal),0.0f);var fuzzReflectionCoords=createReflectionCoords(fragmentInputs.vPositionW,fiberCylinderNormal);let radianceSample: vec3f=sampleRadiance(modifiedFuzzRoughness,uniforms.vReflectionMicrosurfaceInfos.rgb,uniforms.vReflectionInfos
,fuzzGeoInfo
,reflectionSampler
,reflectionSamplerSampler
,fuzzReflectionCoords
#ifdef REALTIME_FILTERING
,uniforms.vReflectionFilteringInfo
#endif
);fuzzEnvironmentLight+=sampleWeight*mix(radianceSample,baseDiffuseEnvironmentLight,fiberBend);totalWeight+=sampleWeight;}
fuzzEnvironmentLight/=totalWeight;
#endif
let dielectricIblFresnel: f32=getReflectanceFromBRDFWithEnvLookup(vec3f(baseDielectricReflectance.F0),vec3f(baseDielectricReflectance.F90),baseGeoInfo.environmentBrdf).r;var dielectricIblColoredFresnel: vec3f=dielectricIblFresnel*specular_color;
#ifdef THIN_FILM
let thinFilmIorScale: f32=clamp(2.0f*abs(thin_film_ior-1.0f),0.0f,1.0f);var thin_film_dielectric: vec3f=evalIridescence(thin_film_outside_ior,thin_film_ior,baseGeoInfo.NdotV,thin_film_thickness,baseDielectricReflectance.coloredF0);let thin_film_desaturation_scale=(thin_film_ior-1.0)*sqrt(thin_film_thickness*0.001f*baseGeoInfo.NdotV);thin_film_dielectric=mix(thin_film_dielectric,vec3(dot(thin_film_dielectric,vec3f(0.3333f))),thin_film_desaturation_scale);dielectricIblColoredFresnel=mix(dielectricIblColoredFresnel,thin_film_dielectric*specular_color,thin_film_weight*thinFilmIorScale);
#endif
var conductorIblFresnel: vec3f=conductorIblFresnel(baseConductorReflectance,baseGeoInfo.NdotV,specular_roughness,baseGeoInfo.environmentBrdf);
#ifdef THIN_FILM
var thinFilmConductorFresnel: vec3f=specular_weight*evalIridescence(thin_film_outside_ior,thin_film_ior,baseGeoInfo.NdotV,thin_film_thickness,baseConductorReflectance.coloredF0);thinFilmConductorFresnel=mix(thinFilmConductorFresnel,vec3(dot(thinFilmConductorFresnel,vec3f(0.3333f))),thin_film_desaturation_scale);conductorIblFresnel=mix(conductorIblFresnel,thinFilmConductorFresnel,thin_film_weight*thinFilmIorScale);
#endif
var coatIblFresnel: f32=0.0;if (coat_weight>0.0) {coatIblFresnel=getReflectanceFromBRDFWithEnvLookup(vec3f(coatReflectance.F0),vec3f(coatReflectance.F90),coatGeoInfo.environmentBrdf).r;}
var slab_diffuse_ibl: vec3f=vec3f(0.,0.,0.);var slab_glossy_ibl: vec3f=vec3f(0.,0.,0.);var slab_metal_ibl: vec3f=vec3f(0.,0.,0.);var slab_coat_ibl: vec3f=vec3f(0.,0.,0.);slab_diffuse_ibl=baseDiffuseEnvironmentLight*uniforms.vLightingIntensity.z;slab_diffuse_ibl*=aoOut.ambientOcclusionColor;slab_glossy_ibl=baseSpecularEnvironmentLight*uniforms.vLightingIntensity.z;slab_metal_ibl=baseSpecularEnvironmentLight*conductorIblFresnel*uniforms.vLightingIntensity.z;var coatAbsorption=vec3f(1.0);if (coat_weight>0.0) {slab_coat_ibl=coatEnvironmentLight*uniforms.vLightingIntensity.z;let hemisphere_avg_fresnel: f32=coatReflectance.F0+0.5f*(1.0f-coatReflectance.F0);var averageReflectance: f32=(coatIblFresnel+hemisphere_avg_fresnel)*0.5f;let roughnessFactor=1.0f-coat_roughness*0.5f;averageReflectance*=roughnessFactor;var darkened_transmission: f32=(1.0f-averageReflectance)*(1.0f-averageReflectance);darkened_transmission=mix(1.0,darkened_transmission,coat_darkening);var sin2: f32=1.0f-coatGeoInfo.NdotV*coatGeoInfo.NdotV;sin2=sin2/(coat_ior*coat_ior);let cos_t: f32=sqrt(1.0f-sin2);let coatPathLength=1.0f/cos_t;let colored_transmission: vec3f=pow(coat_color,vec3f(coatPathLength));coatAbsorption=mix(vec3f(1.0f),colored_transmission*vec3f(darkened_transmission),coat_weight);}
#ifdef FUZZ
let slab_fuzz_ibl=fuzzEnvironmentLight*uniforms.vLightingIntensity.z;
#endif
var slab_subsurface_ibl: vec3f=vec3f(0.,0.,0.);var slab_translucent_base_ibl: vec3f=vec3f(0.,0.,0.);slab_diffuse_ibl*=base_color.rgb;
#define CUSTOM_FRAGMENT_BEFORE_IBLLAYERCOMPOSITION
let material_opaque_base_ibl: vec3f=mix(slab_diffuse_ibl,slab_subsurface_ibl,subsurface_weight);let material_dielectric_base_ibl: vec3f=mix(material_opaque_base_ibl,slab_translucent_base_ibl,transmission_weight);let material_dielectric_gloss_ibl: vec3f=material_dielectric_base_ibl*(1.0-dielectricIblFresnel)+slab_glossy_ibl*dielectricIblColoredFresnel;let material_base_substrate_ibl: vec3f=mix(material_dielectric_gloss_ibl,slab_metal_ibl,base_metalness);let material_coated_base_ibl: vec3f=layer(material_base_substrate_ibl,slab_coat_ibl,coatIblFresnel,coatAbsorption,vec3f(1.0f));
#ifdef FUZZ
material_surface_ibl=layer(material_coated_base_ibl,slab_fuzz_ibl,fuzzIblFresnel*fuzz_weight,vec3(1.0),fuzz_color);
#else
material_surface_ibl=material_coated_base_ibl;
#endif
#endif
`;
// Sideeffect
if (!ShaderStore.IncludesShadersStoreWGSL[name]) {
    ShaderStore.IncludesShadersStoreWGSL[name] = shader;
}
/** @internal */
export const openpbrEnvironmentLightingWGSL = { name, shader };
//# sourceMappingURL=openpbrEnvironmentLighting.js.map