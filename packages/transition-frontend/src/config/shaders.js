const preludeCommon = `
// IMPORTANT:
// This prelude is injected in both vertex and fragment shader be wary
// of precision qualifiers as vertex and fragment precision may differ

#define EPSILON 0.0000001
#define PI 3.141592653589793

#ifdef FOG

uniform mediump vec4 u_fog_color;
uniform mediump vec2 u_fog_range;
uniform mediump float u_fog_horizon_blend;

varying vec3 v_fog_pos;

float fog_range(float depth) {
    // Map [near, far] to [0, 1] without clamping
    return (depth - u_fog_range[0]) / (u_fog_range[1] - u_fog_range[0]);
}

// Assumes z up and camera_dir *normalized* (to avoid computing
// its length multiple times for different functions).
float fog_horizon_blending(vec3 camera_dir) {
    float t = max(0.0, camera_dir.z / u_fog_horizon_blend);
    // Factor of 3 chosen to roughly match smoothstep.
    // See: https://www.desmos.com/calculator/pub31lvshf
    return u_fog_color.a * exp(-3.0 * t * t);
}

// Compute a ramp for fog opacity
//   - t: depth, rescaled to 0 at fogStart and 1 at fogEnd
// See: https://www.desmos.com/calculator/3taufutxid
float fog_opacity(float t) {
    const float decay = 6.0;
    float falloff = 1.0 - min(1.0, exp(-decay * t));

    // Cube without pow() to smooth the onset
    falloff *= falloff * falloff;

    // Scale and clip to 1 at the far limit
    return u_fog_color.a * min(1.0, 1.00747 * falloff);
}

#endif
`;
const preludeFrag = `
#ifdef GL_ES
precision mediump float;
#else

#if !defined(lowp)
#define lowp
#endif

#if !defined(mediump)
#define mediump
#endif

#if !defined(highp)
#define highp
#endif

#endif

highp vec3 hash(highp vec2 p) {
    highp vec3 p3 = fract(p.xyx * vec3(443.8975, 397.2973, 491.1871));
    p3 += dot(p3, p3.yxz + 19.19);
    return fract((p3.xxy + p3.yzz) * p3.zyx);
}

vec3 dither(vec3 color, highp vec2 seed) {
    vec3 rnd = hash(seed) + hash(seed + 0.59374) - 0.5;
    return color + rnd / 255.0;
}
`;
const preludeVert = `
#ifdef GL_ES
precision highp float;
#else

#if !defined(lowp)
#define lowp
#endif

#if !defined(mediump)
#define mediump
#endif

#if !defined(highp)
#define highp
#endif

#endif

// Unpack a pair of values that have been packed into a single float.
// The packed values are assumed to be 8-bit unsigned integers, and are
// packed like so:
// packedValue = floor(input[0]) * 256 + input[1],
vec2 unpack_float(const float packedValue) {
    int packedIntValue = int(packedValue);
    int v0 = packedIntValue / 256;
    return vec2(v0, packedIntValue - v0 * 256);
}

vec2 unpack_opacity(const float packedOpacity) {
    int intOpacity = int(packedOpacity) / 2;
    return vec2(float(intOpacity) / 127.0, mod(packedOpacity, 2.0));
}

// To minimize the number of attributes needed, we encode a 4-component
// color into a pair of floats (i.e. a vec2) as follows:
// [ floor(color.r * 255) * 256 + color.g * 255,
//   floor(color.b * 255) * 256 + color.g * 255 ]
vec4 decode_color(const vec2 encodedColor) {
    return vec4(
        unpack_float(encodedColor[0]) / 255.0,
        unpack_float(encodedColor[1]) / 255.0
    );
}

// Unpack a pair of paint values and interpolate between them.
float unpack_mix_vec2(const vec2 packedValue, const float t) {
    return mix(packedValue[0], packedValue[1], t);
}

// Unpack a pair of paint values and interpolate between them.
vec4 unpack_mix_color(const vec4 packedColors, const float t) {
    vec4 minColor = decode_color(vec2(packedColors[0], packedColors[1]));
    vec4 maxColor = decode_color(vec2(packedColors[2], packedColors[3]));
    return mix(minColor, maxColor, t);
}

// The offset depends on how many pixels are between the world origin and the edge of the tile:
// vec2 offset = mod(pixel_coord, size)
//
// At high zoom levels there are a ton of pixels between the world origin and the edge of the tile.
// The glsl spec only guarantees 16 bits of precision for highp floats. We need more than that.
//
// The pixel_coord is passed in as two 16 bit values:
// pixel_coord_upper = floor(pixel_coord / 2^16)
// pixel_coord_lower = mod(pixel_coord, 2^16)
//
// The offset is calculated in a series of steps that should preserve this precision:
vec2 get_pattern_pos(const vec2 pixel_coord_upper, const vec2 pixel_coord_lower,
    const vec2 pattern_size, const float tile_units_to_pixels, const vec2 pos) {

    vec2 offset = mod(mod(mod(pixel_coord_upper, pattern_size) * 256.0, pattern_size) * 256.0 + pixel_coord_lower, pattern_size);
    return (tile_units_to_pixels * pos + offset) / pattern_size;
}

const vec4 AWAY = vec4(-1000.0, -1000.0, -1000.0, 1); // Normalized device coordinate that is not rendered.
`;
const preludeTerrainVert = './_prelude_terrain.vertex.glsl';
const preludeFogVert = './_prelude_fog.vertex.glsl';
const preludeFogFrag = './_prelude_fog.fragment.glsl';

const circleSpinnerFrag = './circle_spinner.fragment.glsl';
const circleSpinnerVert = './circle_spinner.vertex.glsl';
const circleSpinnerStaticFrag = `
#define TPI 6.28318530718
#define HPI 1.57079632679

varying vec3 v_data;

#pragma mapbox: define highp vec4 color
#pragma mapbox: define mediump float radius
#pragma mapbox: define lowp float blur
#pragma mapbox: define lowp float opacity
#pragma mapbox: define highp vec4 stroke_color
#pragma mapbox: define mediump float stroke_width
#pragma mapbox: define lowp float stroke_opacity

void main() {
    #pragma mapbox: initialize highp vec4 color
    #pragma mapbox: initialize mediump float radius
    #pragma mapbox: initialize lowp float blur
    #pragma mapbox: initialize lowp float opacity
    #pragma mapbox: initialize highp vec4 stroke_color
    #pragma mapbox: initialize mediump float stroke_width
    #pragma mapbox: initialize lowp float stroke_opacity

    vec2 extrude = v_data.xy;
    float extrude_length = length(extrude);

    lowp float antialiasblur = v_data.z;
    float antialiased_blur = -max(blur, antialiasblur);

    float opacity_t = smoothstep(0.0, antialiased_blur, extrude_length - 1.0);

    /*float color_t = stroke_width < 0.01 ? 0.0 : smoothstep(
        antialiased_blur,
        0.0,
        extrude_length - radius / (radius + stroke_width)
    );*/

    int u_integer      = 0;
    int u_integer_angle = 0;
    float decimal_time = 0.0;
    float angle_decimal_time = 0.0;
    
    
    float angle = 0.0;
    //vec4 test_color = vec4(0.0,0.0,0.0,1.0);
    vec2 vtx = vec2(extrude[0], -extrude[1]);
    
    float arc = TPI / 3.0;
    //int arcs_num = 8;
    
    if (vtx.x >= 0.0 && vtx.y >= 0.0) // red, first quadrant
    {
      //test_color = vec4(1.0,0.0,0.0,1.0);
      if (vtx.y == 0.0)
      {
        angle = 0.0;
      }
      else
      {
        angle = atan( vtx.y / vtx.x );
      }
    }
    else if (vtx.x <= 0.0 && vtx.y >= 0.0) // green
    {
      //test_color = vec4(0.0,1.0,0.0,1.0);
      if (vtx.y == 0.0)
      {
        angle = PI;
      }
      else
      {
        angle = PI + atan( vtx.y / vtx.x );
      }
    }
    else if (vtx.x <= 0.0 && vtx.y < 0.0) // blue
    {
      //test_color = vec4(0.0,0.0,1.0,1.0);
      if (vtx.y == 0.0)
      {
        angle = PI;
      }
      else
      {
        angle = PI + atan( vtx.y / vtx.x );
      }
    }
    else if(vtx.x >= 0.0 && vtx.y < 0.0) // yellow
    {
      //test_color = vec4(1.0,1.0,0.0,1.0);
      if (vtx.y == 0.0)
      {
        angle = 0.0;
      }
      else
      {
        angle = TPI + atan( vtx.y / vtx.x );
      }
    }

    
    
    float main_rotating_angle_min = TPI * angle_decimal_time;
    float rotating_angle_min = 0.0;
    float rotating_angle_max = 0.0;
    
    int draw_border = 0;
    
    for (int i = 0; i < 3; i++)
    {
      rotating_angle_min = (TPI * float(i) / 3.0) + main_rotating_angle_min;
      if (rotating_angle_min > TPI)
      {
        rotating_angle_min = rotating_angle_min - TPI;
      }
      rotating_angle_max = arc + rotating_angle_min;
      //if (rotating_angle_max > TPI)
      //{
      //  rotating_angle_max = rotating_angle_max - TPI;
      //}
      
      
      if ((rotating_angle_max > TPI && angle >= 0.0 && angle < rotating_angle_max - TPI) || (angle >= rotating_angle_min && angle < rotating_angle_max))
      {
        if (angle < rotating_angle_min)
        {
          stroke_opacity = stroke_opacity * (angle + TPI - rotating_angle_min) / (arc);
        }
        else
        {
          stroke_opacity = stroke_opacity * (angle - rotating_angle_min) / (arc);
        }
        draw_border = 1;
      }
    }
    
    if (draw_border == 0)
    {
      stroke_opacity = 0.0;
    }
    
    float first_step   = 0.40 + 0.05 * sin(main_rotating_angle_min);
    float second_step  = 0.8;//0.65 + 0.05 * sin(main_rotating_angle_min);
    float third_step   = 1.0;//0.9 + 0.05 * sin(main_rotating_angle_min);
    if (extrude_length <= first_step)
    {
      // see https://thebookofshaders.com/glossary/?search=smoothstep
      opacity_t = smoothstep(1.0 - first_step, 1.0 - first_step - antialiased_blur, -extrude_length + 1.0);
      gl_FragColor = opacity_t * color;
    }
    else if (extrude_length <= second_step)
    {
      opacity_t = smoothstep(1.0 - second_step, 1.0 - second_step - antialiased_blur, -extrude_length + 1.0) - smoothstep(1.0 - first_step + antialiased_blur, 1.0 - first_step, -extrude_length + 1.0);
      gl_FragColor = opacity_t * vec4(1.0,1.0,1.0,1.0);
    }
    else if (extrude_length <= third_step)
    {
      opacity_t = smoothstep(0.0, 0.0 - antialiased_blur, -extrude_length + 1.0) - smoothstep(1.0 - second_step + antialiased_blur, 1.0 - second_step, -extrude_length + 1.0);
      gl_FragColor = opacity_t * stroke_color * stroke_opacity * 0.5;
    }
    else
    {
      gl_FragColor = vec4(0.0,0.0,0.0,0.0);//opacity_t * test_color;
    }



#ifdef OVERDRAW_INSPECTOR
    gl_FragColor = vec4(1.0);
#endif
}

`
const circleSpinnerStaticVert = `
#define NUM_VISIBILITY_RINGS 2
#define INV_SQRT2 0.70710678
#define ELEVATION_BIAS 0.0001

#define NUM_SAMPLES_PER_RING 16

uniform mat4 u_matrix;
uniform vec2 u_extrude_scale;
uniform lowp float u_device_pixel_ratio;
uniform highp float u_camera_to_center_distance;

attribute vec2 a_pos;

varying vec3 v_data;
varying float v_visibility;

#pragma mapbox: define highp vec4 color
#pragma mapbox: define mediump float radius
#pragma mapbox: define lowp float blur
#pragma mapbox: define lowp float opacity
#pragma mapbox: define highp vec4 stroke_color
#pragma mapbox: define mediump float stroke_width
#pragma mapbox: define lowp float stroke_opacity

vec2 calc_offset(vec2 extrusion, float radius, float stroke_width,  float view_scale) {
    return extrusion * (radius + stroke_width) * u_extrude_scale * view_scale;
}

float cantilevered_elevation(vec2 pos, float radius, float stroke_width, float view_scale) {
    vec2 c1 = pos + calc_offset(vec2(-1,-1), radius, stroke_width, view_scale);
    vec2 c2 = pos + calc_offset(vec2(1,-1), radius, stroke_width, view_scale);
    vec2 c3 = pos + calc_offset(vec2(1,1), radius, stroke_width, view_scale);
    vec2 c4 = pos + calc_offset(vec2(-1,1), radius, stroke_width, view_scale);
    float h1 = elevation(c1) + ELEVATION_BIAS;
    float h2 = elevation(c2) + ELEVATION_BIAS;
    float h3 = elevation(c3) + ELEVATION_BIAS;
    float h4 = elevation(c4) + ELEVATION_BIAS;
    return max(h4, max(h3, max(h1,h2)));
}

float circle_elevation(vec2 pos) {
#if defined(TERRAIN)
    return elevation(pos) + ELEVATION_BIAS;
#else
    return 0.0;
#endif
}

vec4 project_vertex(vec2 extrusion, vec4 world_center, vec4 projected_center, float radius, float stroke_width,  float view_scale) {
    vec2 sample_offset = calc_offset(extrusion, radius, stroke_width, view_scale);
#ifdef PITCH_WITH_MAP
    return u_matrix * ( world_center + vec4(sample_offset, 0, 0) );
#else
    return projected_center + vec4(sample_offset, 0, 0);
#endif
}

float get_sample_step() {
#ifdef PITCH_WITH_MAP
    return 2.0 * PI / float(NUM_SAMPLES_PER_RING);
#else
    // We want to only sample the top half of the circle when it is viewport-aligned.
    // This is to prevent the circle from intersecting with the ground plane below it at high pitch.
    return PI / float(NUM_SAMPLES_PER_RING);
#endif
}

void main(void) {
    #pragma mapbox: initialize highp vec4 color
    #pragma mapbox: initialize mediump float radius
    #pragma mapbox: initialize lowp float blur
    #pragma mapbox: initialize lowp float opacity
    #pragma mapbox: initialize highp vec4 stroke_color
    #pragma mapbox: initialize mediump float stroke_width
    #pragma mapbox: initialize lowp float stroke_opacity

    // unencode the extrusion vector that we snuck into the a_pos vector
    vec2 extrude = vec2(mod(a_pos, 2.0) * 2.0 - 1.0);

    // multiply a_pos by 0.5, since we had it * 2 in order to sneak
    // in extrusion data
    vec2 circle_center = floor(a_pos * 0.5);
    // extract height offset for terrain, this returns 0 if terrain is not active
    float height = circle_elevation(circle_center);
    vec4 world_center = vec4(circle_center, height, 1);
    vec4 projected_center = u_matrix * world_center;

    float view_scale = 0.0;
    #ifdef PITCH_WITH_MAP
        #ifdef SCALE_WITH_MAP
            view_scale = 1.0;
        #else
            // Pitching the circle with the map effectively scales it with the map
            // To counteract the effect for pitch-scale: viewport, we rescale the
            // whole circle based on the pitch scaling effect at its central point
            view_scale = projected_center.w / u_camera_to_center_distance;
        #endif
    #else
        #ifdef SCALE_WITH_MAP
            view_scale = u_camera_to_center_distance;
        #else
            view_scale = projected_center.w;
        #endif
    #endif
    gl_Position = project_vertex(extrude, world_center, projected_center, radius, stroke_width, view_scale);

    float visibility = 0.0;
    #ifdef TERRAIN
        float step = get_sample_step();
        #ifdef PITCH_WITH_MAP
            // to prevent the circle from self-intersecting with the terrain underneath on a sloped hill,
            // we calculate the elevation at each corner and pick the highest one when computing visibility.
            float cantilevered_height = cantilevered_elevation(circle_center, radius, stroke_width, view_scale);
            vec4 occlusion_world_center = vec4(circle_center, cantilevered_height, 1);
            vec4 occlusion_projected_center = u_matrix * occlusion_world_center;
        #else
            vec4 occlusion_world_center = world_center;
            vec4 occlusion_projected_center = projected_center;
        #endif
        for(int ring = 0; ring < NUM_VISIBILITY_RINGS; ring++) {
            float scale = (float(ring) + 1.0)/float(NUM_VISIBILITY_RINGS);
            for(int i = 0; i < NUM_SAMPLES_PER_RING; i++) {
                vec2 extrusion = vec2(cos(step * float(i)), -sin(step * float(i))) * scale;
                vec4 frag_pos = project_vertex(extrusion, occlusion_world_center, occlusion_projected_center, radius, stroke_width, view_scale);
                visibility += float(!isOccluded(frag_pos));
            }
        }
        visibility /= float(NUM_VISIBILITY_RINGS) * float(NUM_SAMPLES_PER_RING);
    #else
        visibility = 1.0;
    #endif
    v_visibility = visibility;

    // This is a minimum blur distance that serves as a faux-antialiasing for
    // the circle. since blur is a ratio of the circle's size and the intent is
    // to keep the blur at roughly 1px, the two are inversely related.
    lowp float antialiasblur = 1.0 / u_device_pixel_ratio / (radius + stroke_width);

    v_data = vec3(extrude.x, extrude.y, antialiasblur);

#ifdef FOG
    v_fog_pos = fog_position(world_center.xyz);
#endif
}

`
const lineArrowFrag = './line_arrow.fragment.glsl';
const lineArrowVert = './line_arrow.vertex.glsl';
const lineArrowStaticFrag = `
uniform lowp float u_device_pixel_ratio;

varying vec2 v_width2;
varying vec2 v_normal;
varying float v_gamma_scale;
varying float v_linesofar;

#pragma mapbox: define highp vec4 color
#pragma mapbox: define lowp float blur
#pragma mapbox: define lowp float opacity

void main() {
    #pragma mapbox: initialize highp vec4 color
    #pragma mapbox: initialize lowp float blur
    #pragma mapbox: initialize lowp float opacity

    // Calculate the distance of the pixel from the line in pixels.
    float dist = length(v_normal) * v_width2.s;

    // Calculate the antialiasing fade factor. This is either when fading in
    // the line in case of an offset line (v_width2.t) or when fading out
    // (v_width2.s)
    float blur2 = (blur + 1.0 / u_device_pixel_ratio) * v_gamma_scale;
    float alpha = clamp(min(dist - (v_width2.t - blur2), v_width2.s - dist) / blur2, 0.0, 1.0);

    float arrow_position = mod((v_linesofar + dist * 15.0), 500.0);

    float amount_of_white = 0.0;
    float amount_of_blue  = 0.0;

    if (arrow_position >= 10.0 && arrow_position < 20.0)
    {
        amount_of_white = 0.9;
        gl_FragColor = mix(mix(color, vec4(1.0,1.0,1.0,1.0), amount_of_white) * (alpha * opacity), vec4(0.0,0.0,1.0,1.0), amount_of_blue);
    }
    else if (arrow_position >= 20.0 && arrow_position < 30.0)
    {
        amount_of_white = 0.9 - 0.4 * (1.0 - (30.0 - arrow_position) / 10.0);
        gl_FragColor = mix(mix(color, vec4(1.0,1.0,1.0,1.0), amount_of_white) * (alpha * opacity), vec4(0.0,0.0,1.0,1.0), amount_of_blue);
    }
    else if (arrow_position >= 30.0 && arrow_position < 500.0)
    {
        amount_of_white = 0.5 * (1.0 - arrow_position / 500.0);
        gl_FragColor = mix(mix(color, vec4(0.0,0.0,0.0,1.0), amount_of_white) * (alpha * opacity), vec4(0.0,0.0,1.0,1.0), amount_of_blue);
    }
    else
    {
        gl_FragColor = mix(mix(color, vec4(1.0,1.0,1.0,1.0), 0.0) * (alpha * opacity), vec4(0.0,0.0,1.0,1.0), amount_of_blue);
    }

    #ifdef OVERDRAW_INSPECTOR
        gl_FragColor = vec4(1.0);
    #endif
}`;
const lineArrowStaticVert = `
// floor(127 / 2) == 63.0
// the maximum allowed miter limit is 2.0 at the moment. the extrude normal is
// stored in a byte (-128..127). we scale regular normals up to length 63, but
// there are also "special" normals that have a bigger length (of up to 126 in
// this case).
// #define scale 63.0
#define scale 0.015873016

attribute vec2 a_pos_normal;
attribute vec4 a_data;
attribute float a_linesofar;

uniform mat4 u_matrix;
uniform mediump float u_ratio;
uniform vec2 u_units_to_pixels;
uniform lowp float u_device_pixel_ratio;

varying vec2 v_normal;
varying vec2 v_width2;
varying float v_gamma_scale;
varying float v_linesofar;

#pragma mapbox: define highp vec4 color
#pragma mapbox: define lowp float blur
#pragma mapbox: define lowp float opacity
#pragma mapbox: define mediump float gapwidth
#pragma mapbox: define lowp float offset
#pragma mapbox: define mediump float width

void main() {
    #pragma mapbox: initialize highp vec4 color
    #pragma mapbox: initialize lowp float blur
    #pragma mapbox: initialize lowp float opacity
    #pragma mapbox: initialize mediump float gapwidth
    #pragma mapbox: initialize lowp float offset
    #pragma mapbox: initialize mediump float width

    // the distance over which the line edge fades out.
    // Retina devices need a smaller distance to avoid aliasing.
    float ANTIALIASING = 1.0 / u_device_pixel_ratio / 2.0;

    vec2 a_extrude = a_data.xy - 128.0;
    float a_direction = mod(a_data.z, 4.0) - 1.0;

    //float linesofar = (floor(a_data.z / 4.0) + a_linesofar * 64.0);

    vec2 pos = floor(a_pos_normal * 0.5);

    // x is 1 if it's a round cap, 0 otherwise
    // y is 1 if the normal points up, and -1 if it points down
    // We store these in the least significant bit of a_pos_normal
    mediump vec2 normal = a_pos_normal - 2.0 * pos;
    normal.y = normal.y * 2.0 - 1.0;
    v_normal = normal;

    // these transformations used to be applied in the JS and native code bases.
    // moved them into the shader for clarity and simplicity.
    gapwidth = gapwidth / 2.0;
    float halfwidth = width / 2.0;
    offset = -1.0 * offset;

    float inset = gapwidth + (gapwidth > 0.0 ? ANTIALIASING : 0.0);
    float outset = gapwidth + halfwidth * (gapwidth > 0.0 ? 2.0 : 1.0) + (halfwidth == 0.0 ? 0.0 : ANTIALIASING);

    // Scale the extrusion vector down to a normal and then up by the line width
    // of this vertex.
    mediump vec2 dist = outset * a_extrude * scale;

    // Calculate the offset when drawing a line that is to the side of the actual line.
    // We do this by creating a vector that points towards the extrude, but rotate
    // it when we're drawing round end points (a_direction = -1 or 1) since their
    // extrude vector points in another direction.
    mediump float u = 0.5 * a_direction;
    mediump float t = 1.0 - abs(u);
    mediump vec2 offset2 = offset * a_extrude * scale * normal.y * mat2(t, -u, u, t);

    vec4 projected_extrude = u_matrix * vec4(dist / u_ratio, 0.0, 0.0);
    gl_Position = u_matrix * vec4(pos + offset2 / u_ratio, 0.0, 1.0) + projected_extrude;

    // calculate how much the perspective view squishes or stretches the extrude
    float extrude_length_without_perspective = length(dist);
    float extrude_length_with_perspective = length(projected_extrude.xy / gl_Position.w * u_units_to_pixels);
    v_gamma_scale = extrude_length_without_perspective / extrude_length_with_perspective;

    v_linesofar = a_linesofar;

    v_width2 = vec2(outset, inset);
}
`;

export let preludeTerrain = {};
export let preludeFog = {};

preludeTerrain = compile('', preludeTerrainVert, true);
preludeFog = compile(preludeFogFrag, preludeFogVert, true);

export const prelude = compile(preludeFrag, preludeVert);
export const preludeCommonSource = preludeCommon;

export default {
    circleSpinner: compile(circleSpinnerFrag, circleSpinnerVert),
    circleSpinnerStatic: compile(circleSpinnerStaticFrag, circleSpinnerStaticVert),
    lineArrow: compile(lineArrowFrag, lineArrowVert),
    lineArrowStatic: compile(lineArrowStaticFrag, lineArrowStaticVert)
};

// Expand #pragmas to #ifdefs.
function compile(fragmentSource, vertexSource, isGlobalPrelude) {
    const pragmaRegex = /#pragma mapbox: ([\w]+) ([\w]+) ([\w]+) ([\w]+)/g;
    const uniformRegex = /uniform (highp |mediump |lowp )?([\w]+) ([\w]+)([\s]*)([\w]*)/g;
    const attributeRegex = /attribute (highp |mediump |lowp )?([\w]+) ([\w]+)/g;

    const staticAttributes = vertexSource.match(attributeRegex);
    const fragmentUniforms = fragmentSource.match(uniformRegex);
    const vertexUniforms = vertexSource.match(uniformRegex);
    const commonUniforms = preludeCommon.match(uniformRegex);

    let staticUniforms = vertexUniforms ? vertexUniforms.concat(fragmentUniforms) : fragmentUniforms;

    if (!isGlobalPrelude) {
        if (preludeTerrain.staticUniforms) {
            staticUniforms = preludeTerrain.staticUniforms.concat(staticUniforms);
        }
        if (preludeFog.staticUniforms) {
            staticUniforms = preludeFog.staticUniforms.concat(staticUniforms);
        }
    }

    if (staticUniforms) {
        staticUniforms = staticUniforms.concat(commonUniforms);
    }

    const fragmentPragmas = {};

    fragmentSource = fragmentSource.replace(pragmaRegex, (match, operation, precision, type, name) => {
        fragmentPragmas[name] = true;
        if (operation === 'define') {
            return `
#ifndef HAS_UNIFORM_u_${name}
varying ${precision} ${type} ${name};
#else
uniform ${precision} ${type} u_${name};
#endif
`;
        } else /* if (operation === 'initialize') */ {
            return `
#ifdef HAS_UNIFORM_u_${name}
    ${precision} ${type} ${name} = u_${name};
#endif
`;
        }
    });

    vertexSource = vertexSource.replace(pragmaRegex, (match, operation, precision, type, name) => {
        const attrType = type === 'float' ? 'vec2' : 'vec4';
        const unpackType = name.match(/color/) ? 'color' : attrType;

        if (fragmentPragmas[name]) {
            if (operation === 'define') {
                return `
#ifndef HAS_UNIFORM_u_${name}
uniform lowp float u_${name}_t;
attribute ${precision} ${attrType} a_${name};
varying ${precision} ${type} ${name};
#else
uniform ${precision} ${type} u_${name};
#endif
`;
            } else /* if (operation === 'initialize') */ {
                if (unpackType === 'vec4') {
                    // vec4 attributes are only used for cross-faded properties, and are not packed
                    return `
#ifndef HAS_UNIFORM_u_${name}
    ${name} = a_${name};
#else
    ${precision} ${type} ${name} = u_${name};
#endif
`;
                } else {
                    return `
#ifndef HAS_UNIFORM_u_${name}
    ${name} = unpack_mix_${unpackType}(a_${name}, u_${name}_t);
#else
    ${precision} ${type} ${name} = u_${name};
#endif
`;
                }
            }
        } else {
            if (operation === 'define') {
                return `
#ifndef HAS_UNIFORM_u_${name}
uniform lowp float u_${name}_t;
attribute ${precision} ${attrType} a_${name};
#else
uniform ${precision} ${type} u_${name};
#endif
`;
            } else /* if (operation === 'initialize') */ {
                if (unpackType === 'vec4') {
                    // vec4 attributes are only used for cross-faded properties, and are not packed
                    return `
#ifndef HAS_UNIFORM_u_${name}
    ${precision} ${type} ${name} = a_${name};
#else
    ${precision} ${type} ${name} = u_${name};
#endif
`;
                } else /* */{
                    return `
#ifndef HAS_UNIFORM_u_${name}
    ${precision} ${type} ${name} = unpack_mix_${unpackType}(a_${name}, u_${name}_t);
#else
    ${precision} ${type} ${name} = u_${name};
#endif
`;
                }
            }
        }
    });

    return {fragmentSource, vertexSource, staticAttributes, staticUniforms};
}
