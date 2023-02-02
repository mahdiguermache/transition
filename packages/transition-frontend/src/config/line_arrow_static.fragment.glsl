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
}