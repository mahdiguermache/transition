/*
 * Copyright 2022, Polytechnique Montreal and contributors
 *
 * This file is licensed under the MIT License.
 * License text available at https://opensource.org/licenses/MIT
 */
import maplibregl, { Map, Program } from 'maplibre-gl';
import { isConstructorDeclaration } from 'typescript';

var program;
var circleMap: Map;
var buffer: any;

class highlightLayer {
    constructor() {
        this.id = 'testLayer';
        this.type = 'custom';
        this.renderingMode = '2d';
    }

    public id;
    public type;
    public renderingMode;

    public repaint = true;
    public paint = {
            'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 0, 0, 10, 2, 15, 12, 20, 23],
            'circle-color': {
                property: 'color',
                type: 'identity'
            },
            'circle-opacity': 1.0,
            'circle-stroke-width': ['interpolate', ['exponential', 2], ['zoom'], 0, 0, 10, 0.5, 15, 5, 20, 8],
            'circle-stroke-opacity': 1.0,
            'circle-stroke-color': 'rgba(255,255,255,1.0)'
        }

    private program;
    private map;
    private buffer;

    public onAdd = (map: Map, gl: WebGLRenderingContext) => {
        const vertexSource = `
#define EPSILON 0.0000001
#define PI 3.141592653589793

#define NUM_VISIBILITY_RINGS 2
#define INV_SQRT2 0.70710678

#define NUM_SAMPLES_PER_RING 16

uniform mat4 u_matrix;
uniform vec2 u_extrude_scale;
uniform lowp float u_device_pixel_ratio;
uniform highp float u_camera_to_center_distance;

attribute vec2 a_pos;

varying vec3 v_data;
varying float v_visibility;


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



#ifndef HAS_UNIFORM_u_color
uniform lowp float u_color_t;
attribute highp vec4 a_color;
varying highp vec4 color;
#else
uniform highp vec4 u_color;
#endif


#ifndef HAS_UNIFORM_u_radius
uniform lowp float u_radius_t;
attribute mediump vec2 a_radius;
varying mediump float radius;
#else
uniform mediump float u_radius;
#endif


#ifndef HAS_UNIFORM_u_blur
uniform lowp float u_blur_t;
attribute lowp vec2 a_blur;
varying lowp float blur;
#else
uniform lowp float u_blur;
#endif


#ifndef HAS_UNIFORM_u_opacity
uniform lowp float u_opacity_t;
attribute lowp vec2 a_opacity;
varying lowp float opacity;
#else
uniform lowp float u_opacity;
#endif


#ifndef HAS_UNIFORM_u_stroke_color
uniform lowp float u_stroke_color_t;
attribute highp vec4 a_stroke_color;
varying highp vec4 stroke_color;
#else
uniform highp vec4 u_stroke_color;
#endif


#ifndef HAS_UNIFORM_u_stroke_width
uniform lowp float u_stroke_width_t;
attribute mediump vec2 a_stroke_width;
varying mediump float stroke_width;
#else
uniform mediump float u_stroke_width;
#endif


uniform lowp float u_stroke_opacity_t;
attribute lowp vec2 a_stroke_opacity;
varying lowp float stroke_opacity;


vec2 calc_offset(vec2 extrusion, float radius, float stroke_width,  float view_scale) {
    return extrusion * (radius + stroke_width) * u_extrude_scale * view_scale;
}

float circle_elevation(vec2 pos) {
    return 0.0;
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
    
#ifndef HAS_UNIFORM_u_color
    color = unpack_mix_color(a_color, u_color_t);
#else
    highp vec4 color = u_color;
#endif

    
#ifndef HAS_UNIFORM_u_radius
    radius = unpack_mix_vec2(a_radius, u_radius_t);
#else
    mediump float radius = u_radius;
#endif

    
#ifndef HAS_UNIFORM_u_blur
    blur = unpack_mix_vec2(a_blur, u_blur_t);
#else
    lowp float blur = u_blur;
#endif

    
#ifndef HAS_UNIFORM_u_opacity
    opacity = unpack_mix_vec2(a_opacity, u_opacity_t);
#else
    lowp float opacity = u_opacity;
#endif

    
#ifndef HAS_UNIFORM_u_stroke_color
    stroke_color = unpack_mix_color(a_stroke_color, u_stroke_color_t);
#else
    highp vec4 stroke_color = u_stroke_color;
#endif

    
#ifndef HAS_UNIFORM_u_stroke_width
    stroke_width = unpack_mix_vec2(a_stroke_width, u_stroke_width_t);
#else
    mediump float stroke_width = u_stroke_width;
#endif

    
    stroke_opacity = unpack_mix_vec2(a_stroke_opacity, u_stroke_opacity_t);

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

    float visibility = 1.0;
    
    v_visibility = visibility;

    // This is a minimum blur distance that serves as a faux-antialiasing for
    // the circle. since blur is a ratio of the circle's size and the intent is
    // to keep the blur at roughly 1px, the two are inversely related.
    lowp float antialiasblur = 1.0 / u_device_pixel_ratio / (radius + stroke_width);

    v_data = vec3(extrude.x, extrude.y, antialiasblur);

#ifdef FOG
    v_fog_pos = fog_position(world_center.xyz);
#endif
}`;

        const fragmentSource = `
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
        
#define EPSILON 0.0000001
#define PI 3.141592653589793
        
#define TPI 6.28318530718
#define HPI 1.57079632679

varying vec3 v_data;


#ifndef HAS_UNIFORM_u_color
varying highp vec4 color;
#else
uniform highp vec4 u_color;
#endif


#ifndef HAS_UNIFORM_u_radius
varying mediump float radius;
#else
uniform mediump float u_radius;
#endif


#ifndef HAS_UNIFORM_u_blur
varying lowp float blur;
#else
uniform lowp float u_blur;
#endif


#ifndef HAS_UNIFORM_u_opacity
varying lowp float opacity;
#else
uniform lowp float u_opacity;
#endif


#ifndef HAS_UNIFORM_u_stroke_color
varying highp vec4 stroke_color;
#else
uniform highp vec4 u_stroke_color;
#endif


#ifndef HAS_UNIFORM_u_stroke_width
varying mediump float stroke_width;
#else
uniform mediump float u_stroke_width;
#endif


varying lowp float stroke_opacity;


void main() {
    
#ifdef HAS_UNIFORM_u_color
    highp vec4 color = u_color;
#endif

    
#ifdef HAS_UNIFORM_u_radius
    mediump float radius = u_radius;
#endif

    
#ifdef HAS_UNIFORM_u_blur
    lowp float blur = u_blur;
#endif

    
#ifdef HAS_UNIFORM_u_opacity
    lowp float opacity = u_opacity;
#endif

    
#ifdef HAS_UNIFORM_u_stroke_color
    highp vec4 stroke_color = u_stroke_color;
#endif

    
#ifdef HAS_UNIFORM_u_stroke_width
    mediump float stroke_width = u_stroke_width;
#endif



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
    
    lowp float new_stroke_opacity = stroke_opacity;
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
          new_stroke_opacity = stroke_opacity * (angle + TPI - rotating_angle_min) / (arc);
        }
        else
        {
          new_stroke_opacity = stroke_opacity * (angle - rotating_angle_min) / (arc);
        }
        draw_border = 1;
      }
    }
    
    if (draw_border == 0)
    {
      new_stroke_opacity = 0.0;
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
      gl_FragColor = opacity_t * stroke_color * new_stroke_opacity * 0.5;
    }
    else
    {
      gl_FragColor = vec4(0.0,0.0,0.0,0.0);//opacity_t * test_color;
    }

#ifdef OVERDRAW_INSPECTOR
    gl_FragColor = vec4(1.0);
#endif
}`;

        const vertexShader = gl.createShader(gl.VERTEX_SHADER) as WebGLShader;
        gl.shaderSource(vertexShader, vertexSource);
        gl.compileShader(vertexShader);
        if( !gl.getShaderParameter(vertexShader,gl.COMPILE_STATUS) ) {
            console.log("Error compiling vertex shader");
        }
        const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER) as WebGLShader;
        gl.shaderSource(fragmentShader, fragmentSource);
        gl.compileShader(fragmentShader);
        if( !gl.getShaderParameter(fragmentShader,gl.COMPILE_STATUS) ) {
            console.log("Error compiling fragment shader");
        }

        this.map = map;
        this.program = gl.createProgram();

        gl.attachShader(this.program, vertexShader);
        gl.attachShader(this.program, fragmentShader);
        gl.linkProgram(this.program);
        if( !gl.getProgramParameter(this.program,gl.LINK_STATUS) ) {
            console.log("Error linking shaders");
        }
        
        this.program.aPos = gl.getAttribLocation(this.program, "a_pos");
        // define vertices of the triangle to be rendered in the custom style layer
        var helsinki = maplibregl.MercatorCoordinate.fromLngLat({
            lng: 25.004,
            lat: 60.239
        });
        var berlin = maplibregl.MercatorCoordinate.fromLngLat({
            lng: 13.403,
            lat: 52.562
        });
        var kyiv = maplibregl.MercatorCoordinate.fromLngLat({
            lng: 30.498,
            lat: 50.541
        });
        
        // create and initialize a WebGLBuffer to store vertex and color data
        this.buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
        gl.bufferData(
            gl.ARRAY_BUFFER,
            new Float32Array([
                helsinki.x,
                helsinki.y,
                berlin.x,
                berlin.y,
                kyiv.x,
                kyiv.y
            ]),
            gl.STATIC_DRAW
        );
    }

    public render = (gl: WebGLRenderingContext, matrix) => {
        gl.useProgram(this.program);
        gl.uniformMatrix4fv(gl.getUniformLocation(this.program, 'u_matrix'), false, matrix);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
        gl.enableVertexAttribArray(this.program.aPos);
        gl.vertexAttribPointer(this.program.aPos, 2, gl.FLOAT, false, 0, 0);
        gl.uniform2fv(gl.getUniformLocation(this.program, 'u_extrude_scale'), this.map.transform.pixelsToGLUnits);
        gl.uniform1f(gl.getUniformLocation(this.program, 'u_device_pixel_ratio'), window.devicePixelRatio)
        gl.uniform1f(gl.getUniformLocation(this.program, 'u_camera_to_center_distance'), this.map.transform.cameraToCenterDistance)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 3);
        this.map.triggerRepaint();
    }
}

// this.map?.addLayer(new highlightLayer());

const layersConfig = {
    routingPoints: {
        // for routing origin, destination and waypoints
        type: 'circle',
        paint: {
            'circle-radius': {
                base: 1,
                stops: [
                    [5, 1],
                    [10, 2],
                    [15, 10]
                ]
            },
            'circle-color': {
                property: 'color',
                type: 'identity'
            },
            'circle-opacity': 1.0,
            'circle-stroke-width': {
                base: 1,
                stops: [
                    [5, 1],
                    [11, 1],
                    [12, 2],
                    [14, 3],
                    [15, 4]
                ]
            },
            'circle-stroke-opacity': 1.0,
            'circle-stroke-color': 'rgba(255,255,255,1.0)'
        }
    },

    accessibilityMapPoints: {
        type: 'circle',
        paint: {
            'circle-radius': {
                base: 1,
                stops: [
                    [5, 1],
                    [10, 2],
                    [15, 10]
                ]
            },
            'circle-color': {
                property: 'color',
                type: 'identity'
            },
            'circle-opacity': 1.0,
            'circle-stroke-width': {
                base: 1,
                stops: [
                    [5, 1],
                    [11, 1],
                    [12, 2],
                    [14, 3],
                    [15, 4]
                ]
            },
            'circle-stroke-opacity': 1.0,
            'circle-stroke-color': 'rgba(255,255,255,1.0)'
        }
    },

    accessibilityMapPolygons: {
        type: 'fill',
        paint: {
            'fill-color': {
                property: 'color',
                type: 'identity'
            },
            'fill-opacity': 0.2
        }
    },

    accessibilityMapPolygonStrokes: {
        type: 'line',
        paint: {
            'line-color': 'rgba(255,255,255,1.0)',
            'line-opacity': 0.2,
            'line-width': 1.5
        }
    },

    routingPathsStrokes: {
        type: 'line',
        layout: {
            'line-join': 'round',
            'line-cap': 'round'
        },
        paint: {
            'line-color': 'rgba(255,255,255,1.0)',
            'line-opacity': 0.7,
            'line-width': {
                base: 6,
                stops: [
                    [6, 6],
                    [12, 10],
                    [13, 12]
                ]
            }
        }
    },

    routingPaths: {
        repaint: true,
        type: 'line',
        layout: {
            'line-join': 'round',
            'line-cap': 'round'
        },
        'custom-shader': 'lineArrow',
        paint: {
            'line-color': {
                property: 'color',
                type: 'identity'
            },
            'line-opacity': 1.0,
            'line-width': {
                base: 3,
                stops: [
                    [6, 3],
                    [12, 5],
                    [13, 7]
                ]
            }
        }
    },

    isochronePolygons: {
        type: 'fill',
        paint: {
            'fill-color': {
                property: 'color',
                type: 'identity'
            },
            'fill-opacity': 0.1
        }
    },

    transitPaths: {
        type: 'line',
        minzoom: 9,
        defaultFilter: [
            'any',
            ['all', ['==', ['string', ['get', 'mode']], 'bus'], ['>=', ['zoom'], 11]],
            ['all', ['==', ['string', ['get', 'mode']], 'rail'], ['>=', ['zoom'], 9]],
            ['all', ['==', ['string', ['get', 'mode']], 'highSpeedRail'], ['>=', ['zoom'], 9]],
            ['all', ['==', ['string', ['get', 'mode']], 'metro'], ['>=', ['zoom'], 9]],
            ['all', ['==', ['string', ['get', 'mode']], 'monorail'], ['>=', ['zoom'], 10]],
            ['all', ['==', ['string', ['get', 'mode']], 'tram'], ['>=', ['zoom'], 10]],
            ['all', ['==', ['string', ['get', 'mode']], 'tramTrain'], ['>=', ['zoom'], 10]],
            ['all', ['==', ['string', ['get', 'mode']], 'water'], ['>=', ['zoom'], 9]],
            ['all', ['==', ['string', ['get', 'mode']], 'gondola'], ['>=', ['zoom'], 10]],
            ['all', ['==', ['string', ['get', 'mode']], 'funicular'], ['>=', ['zoom'], 10]],
            ['all', ['==', ['string', ['get', 'mode']], 'taxi'], ['>=', ['zoom'], 11]],
            ['all', ['==', ['string', ['get', 'mode']], 'cableCar'], ['>=', ['zoom'], 10]],
            ['all', ['==', ['string', ['get', 'mode']], 'horse'], ['>=', ['zoom'], 11]],
            ['all', ['==', ['string', ['get', 'mode']], 'other'], ['>=', ['zoom'], 11]]
        ],
        layout: {
            'line-join': 'miter',
            'line-cap': 'butt'
        },
        paint: {
            'line-offset': {
                // we should use turf.js to offset beforehand,
                //but turf offset is not based on zoom and 180 degrees turns creates random coordinates
                base: 1,
                stops: [
                    [13, 0],
                    [16, 4],
                    [20, 20]
                ]
            },
            'line-color': {
                property: 'color',
                type: 'identity'
            },
            'line-opacity': 0.8 /*{ // not working???
        'base': 0,
        'stops': [
          [0, 0.0],
          [7, 0.05],
          [10, 0.2],
          [15, 0.5],
          [20, 0.8]
        ]
      }*/,
            'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 6, 2]
        }
    },

    transitPathsStroke: {
        type: 'line',
        minzoom: 15,
        layout: {
            'line-join': 'miter',
            'line-cap': 'butt'
        },
        paint: {
            'line-offset': {
                // we should use turf.js to offset beforehand,
                //but turf offset is not based on zoom and 180 degrees turns creates random coordinates
                base: 1,
                stops: [
                    [13, 0],
                    [16, 4],
                    [20, 20]
                ]
            },
            'line-color': 'rgba(0,0,0,0.5)',
            'line-opacity': {
                property: 'route_type_shortname',
                type: 'categorical',
                default: 1,
                base: 1,
                stops: [
                    [{ zoom: 0, value: 'bus' }, 0.0],
                    [{ zoom: 0, value: 'tram' }, 0.1],
                    [{ zoom: 0, value: 'metro' }, 0.1],
                    [{ zoom: 0, value: 'rail' }, 0.1],
                    [{ zoom: 0, value: 'ferry' }, 0.1],
                    [{ zoom: 0, value: 'cableCar' }, 0.1],
                    [{ zoom: 0, value: 'gondola' }, 0.1],
                    [{ zoom: 0, value: 'funicular' }, 0.1],

                    [{ zoom: 7, value: 'bus' }, 0.05],
                    [{ zoom: 7, value: 'tram' }, 0.3],
                    [{ zoom: 7, value: 'metro' }, 0.3],
                    [{ zoom: 7, value: 'rail' }, 0.3],
                    [{ zoom: 7, value: 'ferry' }, 0.3],
                    [{ zoom: 7, value: 'cableCar' }, 0.3],
                    [{ zoom: 7, value: 'gondola' }, 0.3],
                    [{ zoom: 7, value: 'funicular' }, 0.3],

                    [{ zoom: 10, value: 'bus' }, 0.2],
                    [{ zoom: 10, value: 'tram' }, 0.6],
                    [{ zoom: 10, value: 'metro' }, 0.6],
                    [{ zoom: 10, value: 'rail' }, 0.6],
                    [{ zoom: 10, value: 'ferry' }, 0.6],
                    [{ zoom: 10, value: 'cableCar' }, 0.6],
                    [{ zoom: 10, value: 'gondola' }, 0.6],
                    [{ zoom: 10, value: 'funicular' }, 0.6],

                    [{ zoom: 15, value: 'bus' }, 0.5],
                    [{ zoom: 15, value: 'tram' }, 0.8],
                    [{ zoom: 15, value: 'metro' }, 1.0],
                    [{ zoom: 15, value: 'rail' }, 0.8],
                    [{ zoom: 15, value: 'ferry' }, 0.8],
                    [{ zoom: 15, value: 'cableCar' }, 0.8],
                    [{ zoom: 15, value: 'gondola' }, 0.8],
                    [{ zoom: 15, value: 'funicular' }, 0.8]
                ]
            },
            //"line-width": {
            //  'base': 1,
            //  'stops': [[5,3], [11, 5], [15, 9]]
            //}
            'line-width': {
                property: 'route_type_shortname',
                type: 'categorical',
                default: 1,
                base: 1,
                stops: [
                    [{ zoom: 0, value: 'bus' }, 1],
                    [{ zoom: 0, value: 'tram' }, 1],
                    [{ zoom: 0, value: 'metro' }, 1],
                    [{ zoom: 0, value: 'rail' }, 1],
                    [{ zoom: 0, value: 'ferry' }, 1],
                    [{ zoom: 0, value: 'cableCar' }, 1],
                    [{ zoom: 0, value: 'gondola' }, 1],
                    [{ zoom: 0, value: 'funicular' }, 1],

                    [{ zoom: 10, value: 'bus' }, 3],
                    [{ zoom: 10, value: 'tram' }, 5],
                    [{ zoom: 10, value: 'metro' }, 5],
                    [{ zoom: 10, value: 'rail' }, 5],
                    [{ zoom: 10, value: 'ferry' }, 5],
                    [{ zoom: 10, value: 'cableCar' }, 5],
                    [{ zoom: 10, value: 'gondola' }, 5],
                    [{ zoom: 10, value: 'funicular' }, 5],

                    [{ zoom: 15, value: 'bus' }, 5],
                    [{ zoom: 15, value: 'tram' }, 7],
                    [{ zoom: 15, value: 'metro' }, 9],
                    [{ zoom: 15, value: 'rail' }, 7],
                    [{ zoom: 15, value: 'ferry' }, 7],
                    [{ zoom: 15, value: 'cableCar' }, 7],
                    [{ zoom: 15, value: 'gondola' }, 7],
                    [{ zoom: 15, value: 'funicular' }, 7]
                ]
            }
        }
    },

    transitPathsHoverStroke: {
        type: 'line',
        repaint: true,
        layout: {
            'line-join': 'miter',
            'line-cap': 'butt'
            //"line-round-limit": 1.05
        },
        paint: {
            'line-offset': {
                base: 1,
                stops: [
                    [13, 0],
                    [16, 4],
                    [20, 20]
                ]
            },
            'line-color': 'rgba(255,255,255,1.0)',
            'line-opacity': 0.7,
            'line-width': {
                base: 1,
                stops: [
                    [6, 7],
                    [12, 9],
                    [13, 11]
                ]
            }
        }
    },

    transitPathsSelected: {
        type: 'line',
        repaint: true,
        //"shaders": [transitPathsSelectedFragmentShader, transitPathsSelectedVertexShader],
        layout: {
            'line-join': 'miter',
            'line-cap': 'butt'
        },
        'custom-shader': 'lineArrow',
        paint: {
            //"line-arrow": true,
            'line-offset': {
                base: 1,
                stops: [
                    [13, 0],
                    [16, 4],
                    [20, 20]
                ]
            },
            //"line-color": "rgba(0,0,255,1.0)",
            'line-color': {
                property: 'color',
                type: 'identity'
            },
            'line-opacity': 1.0,
            'line-width': {
                base: 1,
                stops: [
                    [6, 5],
                    [12, 7],
                    [13, 9]
                ]
            } //,
            //'line-gradient': [
            //  'interpolate',
            //  ['linear'],
            //  ['line-progress'],
            //  0, "blue",
            //  1.0, "red"
            //]
        }
    },

    transitPathWaypoints: {
        type: 'circle',
        paint: {
            'circle-radius': {
                base: 1,
                stops: [
                    [5, 1],
                    [10, 2],
                    [15, 5]
                ]
            },
            'circle-color': 'rgba(0,0,0,1.0)',
            'circle-opacity': 0.5,
            'circle-stroke-width': {
                base: 1,
                stops: [
                    [5, 1],
                    [11, 1],
                    [12, 2],
                    [14, 2],
                    [15, 3]
                ]
            },
            'circle-stroke-opacity': 0.7,
            'circle-stroke-color': 'rgba(255,255,255,1.0)'
        }
    },

    transitPathWaypointsSelected: {
        type: 'circle',
        paint: {
            'circle-radius': {
                base: 1,
                stops: [
                    [5, 1],
                    [10, 3],
                    [15, 6]
                ]
            },
            'circle-color': 'rgba(0,0,0,1.0)',
            'circle-opacity': 0.5,
            'circle-stroke-width': {
                base: 1,
                stops: [
                    [5, 1],
                    [11, 1],
                    [12, 2],
                    [14, 2],
                    [15, 3]
                ]
            },
            'circle-stroke-opacity': 0.85,
            'circle-stroke-color': 'rgba(255,255,255,1.0)'
        }
    },

    transitPathWaypointsErrors: {
        type: 'circle',
        paint: {
            'circle-radius': {
                base: 1,
                stops: [
                    [5, 1],
                    [10, 2],
                    [15, 5]
                ]
            },
            'circle-opacity': 0,
            'circle-stroke-width': {
                base: 1,
                stops: [
                    [5, 2],
                    [11, 2],
                    [12, 4],
                    [14, 4],
                    [15, 6]
                ]
            },
            'circle-stroke-opacity': 0.7,
            'circle-stroke-color': 'rgba(255,0,0,1.0)'
        }
    },

    transitPathsForServices: {
        type: 'line',
        minzoom: 9,
        defaultFilter: [
            'any',
            ['all', ['==', ['string', ['get', 'mode']], 'bus'], ['>=', ['zoom'], 11]],
            ['all', ['==', ['string', ['get', 'mode']], 'rail'], ['>=', ['zoom'], 9]],
            ['all', ['==', ['string', ['get', 'mode']], 'highSpeedRail'], ['>=', ['zoom'], 9]],
            ['all', ['==', ['string', ['get', 'mode']], 'metro'], ['>=', ['zoom'], 9]],
            ['all', ['==', ['string', ['get', 'mode']], 'monorail'], ['>=', ['zoom'], 10]],
            ['all', ['==', ['string', ['get', 'mode']], 'tram'], ['>=', ['zoom'], 10]],
            ['all', ['==', ['string', ['get', 'mode']], 'tramTrain'], ['>=', ['zoom'], 10]],
            ['all', ['==', ['string', ['get', 'mode']], 'water'], ['>=', ['zoom'], 9]],
            ['all', ['==', ['string', ['get', 'mode']], 'gondola'], ['>=', ['zoom'], 10]],
            ['all', ['==', ['string', ['get', 'mode']], 'funicular'], ['>=', ['zoom'], 10]],
            ['all', ['==', ['string', ['get', 'mode']], 'taxi'], ['>=', ['zoom'], 11]],
            ['all', ['==', ['string', ['get', 'mode']], 'cableCar'], ['>=', ['zoom'], 10]],
            ['all', ['==', ['string', ['get', 'mode']], 'horse'], ['>=', ['zoom'], 11]],
            ['all', ['==', ['string', ['get', 'mode']], 'other'], ['>=', ['zoom'], 11]]
        ],
        layout: {
            'line-join': 'miter',
            'line-cap': 'butt'
        },
        paint: {
            'line-offset': {
                // we should use turf.js to offset beforehand,
                //but turf offset is not based on zoom and 180 degrees turns creates random coordinates
                base: 1,
                stops: [
                    [13, 0],
                    [16, 4],
                    [20, 20]
                ]
            },
            'line-color': {
                property: 'color',
                type: 'identity'
            },
            'line-opacity': 0.8 /*{ // not working???
        'base': 0,
        'stops': [
          [0, 0.0],
          [7, 0.05],
          [10, 0.2],
          [15, 0.5],
          [20, 0.8]
        ]
      }*/,
            'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 6, 2]
        }
    },

    transitStations: {
        type: 'circle',
        minzoom: 11,
        paint: {
            'circle-radius': {
                base: 1,
                stops: [
                    [5, 1],
                    [10, 1],
                    [11, 2],
                    [15, 7],
                    [20, 12]
                ]
            },
            'circle-color': {
                property: 'color',
                type: 'identity'
            },
            'circle-opacity': {
                base: 1,
                stops: [
                    [5, 0.0],
                    [8, 0.2],
                    [12, 0.3],
                    [13, 0.4],
                    [14, 0.5],
                    [15, 0.7],
                    [16, 0.9]
                ]
            },
            'circle-stroke-width': {
                base: 1,
                stops: [
                    [5, 1],
                    [11, 1],
                    [12, 1],
                    [14, 1],
                    [15, 2]
                ]
            },
            'circle-stroke-opacity': {
                base: 1,
                stops: [
                    [5, 0.0],
                    [8, 0.2],
                    [12, 0.3],
                    [13, 0.4],
                    [14, 0.5],
                    [15, 0.7],
                    [16, 0.9]
                ]
            },
            'circle-stroke-color': {
                property: 'status',
                type: 'categorical',
                stops: [
                    ['default', 'rgba(255,255,255,1.0)'],
                    ['almost_hidden', 'rgba(255,255,255,0.3)']
                ]
            }
        }
    },

    transitStationsSelected: {
        type: 'circle',
        minzoom: 11,
        paint: {
            'circle-radius': {
                base: 1,
                stops: [
                    [5, 1],
                    [10, 1],
                    [11, 2],
                    [15, 7],
                    [20, 12]
                ]
            },
            'circle-color': {
                property: 'color',
                type: 'identity'
            },
            'circle-opacity': {
                base: 1,
                stops: [
                    [5, 0.0],
                    [8, 0.2],
                    [12, 0.3],
                    [13, 0.4],
                    [14, 0.5],
                    [15, 0.7],
                    [16, 0.9]
                ]
            },
            'circle-stroke-width': {
                base: 1,
                stops: [
                    [5, 1],
                    [11, 1],
                    [12, 1],
                    [14, 1],
                    [15, 2]
                ]
            },
            'circle-stroke-opacity': {
                base: 1,
                stops: [
                    [5, 0.0],
                    [8, 0.2],
                    [12, 0.3],
                    [13, 0.4],
                    [14, 0.5],
                    [15, 0.7],
                    [16, 0.9]
                ]
            },
            'circle-stroke-color': {
                property: 'status',
                type: 'categorical',
                stops: [
                    ['default', 'rgba(255,255,255,1.0)'],
                    ['almost_hidden', 'rgba(255,255,255,0.3)']
                ]
            }
        }
    },

    transitNodes: {
        type: 'circle',
        minzoom: 11,
        paint: {
            'circle-radius': [
                'interpolate',
                ['exponential', 2],
                ['zoom'],
                0,
                ['*', ['number', ['feature-state', 'size'], 1], 0],
                10,
                ['*', ['number', ['feature-state', 'size'], 1], 1.5],
                15,
                ['*', ['number', ['feature-state', 'size'], 1], 8],
                20,
                ['*', ['number', ['feature-state', 'size'], 1], 15]
            ],
            'circle-color': {
                property: 'color',
                type: 'identity'
            },
            'circle-opacity': [
                'interpolate',
                ['linear'],
                ['zoom'],
                10,
                ['case', ['boolean', ['feature-state', 'hover'], false], 1.0, 0.1],
                15,
                ['case', ['boolean', ['feature-state', 'hover'], false], 1.0, 0.8],
                20,
                ['case', ['boolean', ['feature-state', 'hover'], false], 1.0, 0.9]
            ],
            'circle-stroke-width': [
                'interpolate',
                ['exponential', 2],
                ['zoom'],
                0,
                ['*', ['number', ['feature-state', 'size'], 1], 0],
                10,
                ['*', ['number', ['feature-state', 'size'], 1], 0.2],
                15,
                ['*', ['number', ['feature-state', 'size'], 1], 3],
                20,
                ['*', ['number', ['feature-state', 'size'], 1], 5]
            ],
            'circle-stroke-opacity': [
                'interpolate',
                ['linear'],
                ['zoom'],
                10,
                ['case', ['boolean', ['feature-state', 'hover'], false], 1.0, 0.1],
                15,
                ['case', ['boolean', ['feature-state', 'hover'], false], 1.0, 0.8],
                20,
                ['case', ['boolean', ['feature-state', 'hover'], false], 1.0, 0.9]
            ],
            'circle-stroke-color': 'rgba(255,255,255,1.0)'
        }
    },

    transitNodes250mRadius: {
        type: 'circle',
        paint: {
            'circle-radius': [
                'interpolate',
                ['exponential', 2],
                ['zoom'],
                0,
                0,
                20,
                ['get', '_250mRadiusPixelsAtMaxZoom']
            ],
            'circle-color': 'hsla(93, 100%, 63%, 0.08)',
            'circle-stroke-width': 3,
            'circle-stroke-color': 'hsla(93, 100%, 63%, 0.10)'
        }
    },

    transitNodes500mRadius: {
        type: 'circle',
        paint: {
            'circle-radius': [
                'interpolate',
                ['exponential', 2],
                ['zoom'],
                0,
                0,
                20,
                ['get', '_500mRadiusPixelsAtMaxZoom']
            ],
            'circle-color': 'hsla(74, 100%, 63%, 0.06)',
            'circle-stroke-width': 2,
            'circle-stroke-color': 'hsla(74, 100%, 63%, 0.075)'
        }
    },

    transitNodes750mRadius: {
        type: 'circle',
        paint: {
            'circle-radius': [
                'interpolate',
                ['exponential', 2],
                ['zoom'],
                0,
                0,
                20,
                ['get', '_750mRadiusPixelsAtMaxZoom']
            ],
            'circle-color': 'hsla(49, 100%, 63%, 0.025)',
            'circle-stroke-width': 1,
            'circle-stroke-color': 'hsla(49, 100%, 63%, 0.075)'
        }
    },

    transitNodes1000mRadius: {
        type: 'circle',
        paint: {
            'circle-radius': [
                'interpolate',
                ['exponential', 2],
                ['zoom'],
                0,
                0,
                20,
                ['get', '_1000mRadiusPixelsAtMaxZoom']
            ],
            'circle-color': 'hsla(6, 100%, 63%, 0.02)',
            'circle-stroke-width': 1,
            'circle-stroke-color': 'hsla(6, 100%, 63%, 0.075)'
        }
    },

    transitNodesSelected: {
        type: 'custom',
        // 'custom-shader': 'circleSpinner',
        repaint: true,
        paint: {
            'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 0, 0, 10, 2, 15, 12, 20, 23],
            'circle-color': {
                property: 'color',
                type: 'identity'
            },
            'circle-opacity': 1.0,
            'circle-stroke-width': ['interpolate', ['exponential', 2], ['zoom'], 0, 0, 10, 0.5, 15, 5, 20, 8],
            'circle-stroke-opacity': 1.0,
            'circle-stroke-color': 'rgba(255,255,255,1.0)'
        },
    
        onAdd: (map: Map, gl: WebGLRenderingContext) => {
            const vertexSource = `
    #define EPSILON 0.0000001
    #define PI 3.141592653589793
    
    #define NUM_VISIBILITY_RINGS 2
    #define INV_SQRT2 0.70710678
    
    #define NUM_SAMPLES_PER_RING 16
    
    uniform mat4 u_matrix;
    uniform vec2 u_extrude_scale;
    uniform lowp float u_device_pixel_ratio;
    uniform highp float u_camera_to_center_distance;
    
    attribute vec2 a_pos;
    
    varying vec3 v_data;
    varying float v_visibility;
    
    
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
    
    
    
    #ifndef HAS_UNIFORM_u_color
    uniform lowp float u_color_t;
    attribute highp vec4 a_color;
    varying highp vec4 color;
    #else
    uniform highp vec4 u_color;
    #endif
    
    
    #ifndef HAS_UNIFORM_u_radius
    uniform lowp float u_radius_t;
    attribute mediump vec2 a_radius;
    varying mediump float radius;
    #else
    uniform mediump float u_radius;
    #endif
    
    
    #ifndef HAS_UNIFORM_u_blur
    uniform lowp float u_blur_t;
    attribute lowp vec2 a_blur;
    varying lowp float blur;
    #else
    uniform lowp float u_blur;
    #endif
    
    
    #ifndef HAS_UNIFORM_u_opacity
    uniform lowp float u_opacity_t;
    attribute lowp vec2 a_opacity;
    varying lowp float opacity;
    #else
    uniform lowp float u_opacity;
    #endif
    
    
    #ifndef HAS_UNIFORM_u_stroke_color
    uniform lowp float u_stroke_color_t;
    attribute highp vec4 a_stroke_color;
    varying highp vec4 stroke_color;
    #else
    uniform highp vec4 u_stroke_color;
    #endif
    
    
    #ifndef HAS_UNIFORM_u_stroke_width
    uniform lowp float u_stroke_width_t;
    attribute mediump vec2 a_stroke_width;
    varying mediump float stroke_width;
    #else
    uniform mediump float u_stroke_width;
    #endif
    
    
    uniform lowp float u_stroke_opacity_t;
    attribute lowp vec2 a_stroke_opacity;
    varying lowp float stroke_opacity;
    
    
    vec2 calc_offset(vec2 extrusion, float radius, float stroke_width,  float view_scale) {
        return extrusion * (radius + stroke_width) * u_extrude_scale * view_scale;
    }
    
    float circle_elevation(vec2 pos) {
        return 0.0;
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
        
    #ifndef HAS_UNIFORM_u_color
        color = unpack_mix_color(a_color, u_color_t);
    #else
        highp vec4 color = u_color;
    #endif
    
        
    #ifndef HAS_UNIFORM_u_radius
        radius = unpack_mix_vec2(a_radius, u_radius_t);
    #else
        mediump float radius = u_radius;
    #endif
    
        
    #ifndef HAS_UNIFORM_u_blur
        blur = unpack_mix_vec2(a_blur, u_blur_t);
    #else
        lowp float blur = u_blur;
    #endif
    
        
    #ifndef HAS_UNIFORM_u_opacity
        opacity = unpack_mix_vec2(a_opacity, u_opacity_t);
    #else
        lowp float opacity = u_opacity;
    #endif
    
        
    #ifndef HAS_UNIFORM_u_stroke_color
        stroke_color = unpack_mix_color(a_stroke_color, u_stroke_color_t);
    #else
        highp vec4 stroke_color = u_stroke_color;
    #endif
    
        
    #ifndef HAS_UNIFORM_u_stroke_width
        stroke_width = unpack_mix_vec2(a_stroke_width, u_stroke_width_t);
    #else
        mediump float stroke_width = u_stroke_width;
    #endif
    
        
        stroke_opacity = unpack_mix_vec2(a_stroke_opacity, u_stroke_opacity_t);
    
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
    
        float visibility = 1.0;
        
        v_visibility = visibility;
    
        // This is a minimum blur distance that serves as a faux-antialiasing for
        // the circle. since blur is a ratio of the circle's size and the intent is
        // to keep the blur at roughly 1px, the two are inversely related.
        lowp float antialiasblur = 1.0 / u_device_pixel_ratio / (radius + stroke_width);
    
        v_data = vec3(extrude.x, extrude.y, antialiasblur);
    
    #ifdef FOG
        v_fog_pos = fog_position(world_center.xyz);
    #endif
    }`;
    
            const fragmentSource = `
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
            
    #define EPSILON 0.0000001
    #define PI 3.141592653589793
            
    #define TPI 6.28318530718
    #define HPI 1.57079632679
    
    varying vec3 v_data;
    
    
    #ifndef HAS_UNIFORM_u_color
    varying highp vec4 color;
    #else
    uniform highp vec4 u_color;
    #endif
    
    
    #ifndef HAS_UNIFORM_u_radius
    varying mediump float radius;
    #else
    uniform mediump float u_radius;
    #endif
    
    
    #ifndef HAS_UNIFORM_u_blur
    varying lowp float blur;
    #else
    uniform lowp float u_blur;
    #endif
    
    
    #ifndef HAS_UNIFORM_u_opacity
    varying lowp float opacity;
    #else
    uniform lowp float u_opacity;
    #endif
    
    
    #ifndef HAS_UNIFORM_u_stroke_color
    varying highp vec4 stroke_color;
    #else
    uniform highp vec4 u_stroke_color;
    #endif
    
    
    #ifndef HAS_UNIFORM_u_stroke_width
    varying mediump float stroke_width;
    #else
    uniform mediump float u_stroke_width;
    #endif
    
    
    varying lowp float stroke_opacity;
    
    
    void main() {
        
    #ifdef HAS_UNIFORM_u_color
        highp vec4 color = u_color;
    #endif
    
        
    #ifdef HAS_UNIFORM_u_radius
        mediump float radius = u_radius;
    #endif
    
        
    #ifdef HAS_UNIFORM_u_blur
        lowp float blur = u_blur;
    #endif
    
        
    #ifdef HAS_UNIFORM_u_opacity
        lowp float opacity = u_opacity;
    #endif
    
        
    #ifdef HAS_UNIFORM_u_stroke_color
        highp vec4 stroke_color = u_stroke_color;
    #endif
    
        
    #ifdef HAS_UNIFORM_u_stroke_width
        mediump float stroke_width = u_stroke_width;
    #endif
    
    
    
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
        
        lowp float new_stroke_opacity = stroke_opacity;
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
              new_stroke_opacity = stroke_opacity * (angle + TPI - rotating_angle_min) / (arc);
            }
            else
            {
              new_stroke_opacity = stroke_opacity * (angle - rotating_angle_min) / (arc);
            }
            draw_border = 1;
          }
        }
        
        if (draw_border == 0)
        {
          new_stroke_opacity = 0.0;
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
          gl_FragColor = opacity_t * stroke_color * new_stroke_opacity * 0.5;
        }
        else
        {
          gl_FragColor = vec4(0.0,0.0,0.0,0.0);//opacity_t * test_color;
        }
    
    #ifdef OVERDRAW_INSPECTOR
        gl_FragColor = vec4(1.0);
    #endif

        gl_FragColor = vec4(0.0,0.0,0.0,1.0);
    }`;
    
            const vertexShader = gl.createShader(gl.VERTEX_SHADER) as WebGLShader;
            gl.shaderSource(vertexShader, vertexSource);
            gl.compileShader(vertexShader);
            if( !gl.getShaderParameter(vertexShader,gl.COMPILE_STATUS) ) {
                console.log("Error compiling vertex shader");
            }
            const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER) as WebGLShader;
            gl.shaderSource(fragmentShader, fragmentSource);
            gl.compileShader(fragmentShader);
            if( !gl.getShaderParameter(fragmentShader,gl.COMPILE_STATUS) ) {
                console.log("Error compiling fragment shader");
            }
    
            circleMap = map;
            program = gl.createProgram();
    
            gl.attachShader(program, vertexShader);
            gl.attachShader(program, fragmentShader);
            gl.linkProgram(program);
            if( !gl.getProgramParameter(program,gl.LINK_STATUS) ) {
                console.log("Error linking shaders");
            }
            
            program.aPos = gl.getAttribLocation(program, "a_pos");
            // define vertices of the triangle to be rendered in the custom style layer
            var helsinki = maplibregl.MercatorCoordinate.fromLngLat({
                lng: -73.7024,
                lat: 45.52594
            });
            var berlin = maplibregl.MercatorCoordinate.fromLngLat({
                lng: -73.4524,
                lat: 45.3572
            });
            var kyiv = maplibregl.MercatorCoordinate.fromLngLat({
                lng: -73.3524,
                lat: 45.6572
            });
            
            // create and initialize a WebGLBuffer to store vertex and color data
            buffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            gl.bufferData(
                gl.ARRAY_BUFFER,
                new Float32Array([
                    helsinki.x,
                    helsinki.y,
                    berlin.x,
                    berlin.y,
                    kyiv.x,
                    kyiv.y
                ]),
                gl.STATIC_DRAW
            );
        },
    
        render: (gl: WebGLRenderingContext, matrix) => {
            gl.useProgram(program);
            gl.uniformMatrix4fv(gl.getUniformLocation(program, 'u_matrix'), false, matrix);
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            gl.enableVertexAttribArray(program.aPos);
            gl.vertexAttribPointer(program.aPos, 2, gl.FLOAT, false, 0, 0);
            gl.uniform2fv(gl.getUniformLocation(program, 'u_extrude_scale'), circleMap.transform.pixelsToGLUnits);
            gl.uniform1f(gl.getUniformLocation(program, 'u_device_pixel_ratio'), window.devicePixelRatio)
            gl.uniform1f(gl.getUniformLocation(program, 'u_camera_to_center_distance'), circleMap.transform.cameraToCenterDistance)
            gl.drawArrays(gl.POINTS, 0, 100);
            circleMap.triggerRepaint();
            console.log("render circle")
        }
    },

    transitNodesSelectedErrors: {
        type: 'circle',
        paint: {
            'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 0, 0, 10, 4, 15, 15, 20, 30],
            'circle-color': {
                property: 'color',
                type: 'identity'
            },
            'circle-opacity': 0,
            'circle-stroke-width': ['interpolate', ['exponential', 2], ['zoom'], 0, 0, 10, 1, 15, 8, 20, 12],
            'circle-stroke-opacity': 1.0,
            'circle-stroke-color': 'rgba(255,0,0,1.0)'
        }
    },

    transitNodesRoutingRadius: {
        type: 'circle',
        paint: {
            'circle-radius': [
                'interpolate',
                ['exponential', 2],
                ['zoom'],
                0,
                0,
                20,
                ['get', '_routingRadiusPixelsAtMaxZoom']
            ],
            'circle-color': {
                property: 'color',
                type: 'identity'
            },
            'circle-opacity': 0.2,
            //"circle-color"       : {
            //  property: 'color',
            //  type: 'identity'
            //},
            'circle-stroke-width': 1,
            'circle-stroke-opacity': 0.3,
            'circle-stroke-color': {
                property: 'color',
                type: 'identity'
            }
        }
    },

    transitNodesStationSelected: {
        type: 'circle',
        paint: {
            'circle-radius': {
                base: 1,
                stops: [
                    [5, 2],
                    [10, 3],
                    [15, 15]
                ]
            },
            'circle-color': {
                property: 'color',
                type: 'identity'
            },
            'circle-stroke-width': {
                base: 1,
                stops: [
                    [5, 1],
                    [11, 1],
                    [12, 2],
                    [14, 3],
                    [15, 4]
                ]
            },
            'circle-stroke-color': {
                property: 'station_color',
                type: 'identity'
            }
        }
    },

    testLayer: new highlightLayer()
};

export default layersConfig;
