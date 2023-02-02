uniform mat4 u_matrix;
void main() {
    gl_Position = u_matrix * vec4(0.5, 0.5, 0.0, 1.0);
    gl_PointSize = 20.0;
}