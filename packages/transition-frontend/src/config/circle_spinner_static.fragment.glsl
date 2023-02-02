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
