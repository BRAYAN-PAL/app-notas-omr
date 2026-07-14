import { Injectable } from '@angular/core';

export interface ResultadoCorreccion {
  correctas: number;
  incorrectas: number;
  nota: number;
  detalle: string;
  respuestas: string;
  respuestasDetectadas: string[];
}

export interface ConfiguracionOMR {
  preguntas: number;
  opciones: number;   // A,B,C,D = 4
  inicioX: number;    // % de la imagen donde empiezan las burbujas
  inicioY: number;
  espacioX: number;
  espacioY: number;
  umbralRelleno: number; // % de pixeles negros para considerar relleno
}

@Injectable({
  providedIn: 'root'
})
export class CorrectorLocalService {

  private balotarioRespuestas: string[] = [];
  private nombreBalotario: string = '';
  private totalPreguntas: number = 0;
  private balotarioBase64: string = '';

  // Letras para las opciones
  private letras = ['A', 'B', 'C', 'D', 'E'];

  constructor() {}

  // ============================================================
  //   EXTRACCIÓN DE RESPUESTAS DESDE TEXTO (para balotario)
  // ============================================================

  private extraerRespuestas(texto: string): string[] {
    const limpio = texto.toUpperCase().trim();
    const respuestas: string[] = [];
    const regex = /[ABCDEF]/g;
    let match;
    while ((match = regex.exec(limpio)) !== null) {
      respuestas.push(match[0]);
    }
    return respuestas;
  }

  // ============================================================
  //   OMR - RECONOCIMIENTO ÓPTICO DE MARCAS EN IMAGEN
  // ============================================================

  /**
   * Procesa una imagen de hoja de burbujas y extrae las respuestas marcadas
   * Detecta círculos rellenos analizando pixeles
   */
  private async analizarImagenOMR(imageData: ImageData): Promise<string[]> {
    const respuestas: string[] = [];
    const { width, height, data } = imageData;

    // Configuración por defecto para hojas de examen tipo burbujas
    // Se asume un diseño estándar: preguntas en filas, opciones A,B,C,D en columnas
    const config: ConfiguracionOMR = {
      preguntas: 10,
      opciones: 4,
      inicioX: 0.30,  // 30% del ancho - donde empiezan las burbujas
      inicioY: 0.15,  // 15% del alto - donde empieza la primera burbuja
      espacioX: 0,     // no hay espacio horizontal (todas las opciones en la misma fila)
      espacioY: 0.07,  // 7% del alto entre cada pregunta
      umbralRelleno: 0.35  // 35% de pixeles oscuros = está relleno
    };

    // Detectar automáticamente el número de preguntas basado en el balotario
    if (this.totalPreguntas > 0) {
      config.preguntas = this.totalPreguntas;
    }

    // Recorrer cada pregunta y sus opciones
    for (let p = 0; p < config.preguntas; p++) {
      let opcionSeleccionada = '';
      let maxRelleno = 0;

      // Para cada opción (A, B, C, D)
      for (let o = 0; o < config.opciones; o++) {
        // Calcular la región de la burbuja
        const burbujaX = Math.floor(width * (config.inicioX + o * 0.08));
        const burbujaY = Math.floor(height * (config.inicioY + p * config.espacioY));
        const radio = Math.floor(Math.min(width, height) * 0.015); // 1.5% del tamaño

        // Analizar si la burbuja está rellena
        const nivelRelleno = this.analizarBurbuja(data, width, height, burbujaX, burbujaY, radio);

        if (nivelRelleno > maxRelleno) {
          maxRelleno = nivelRelleno;
          opcionSeleccionada = this.letras[o];
        }
      }

      // Solo considerar si supera el umbral
      respuestas.push(maxRelleno > config.umbralRelleno ? opcionSeleccionada : '');
    }

    return respuestas;
  }

  /**
   * Analiza una región circular de la imagen para determinar si está rellena
   * Retorna el porcentaje de pixeles oscuros (0-1)
   */
  private analizarBurbuja(
    data: Uint8ClampedArray,
    imgWidth: number,
    imgHeight: number,
    cx: number,
    cy: number,
    radio: number
  ): number {
    let pixelesOscuros = 0;
    let pixelesTotales = 0;

    // Umbral para considerar un pixel como "oscuro" (relleno)
    const umbralOscuro = 100;

    // Recorrer un cuadrado alrededor del círculo
    for (let y = Math.max(0, cy - radio); y < Math.min(imgHeight, cy + radio); y++) {
      for (let x = Math.max(0, cx - radio); x < Math.min(imgWidth, cx + radio); x++) {
        // Verificar si está dentro del círculo
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy > radio * radio) continue;

        pixelesTotales++;

        const idx = (y * imgWidth + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        // Calcular brillo (promedio RGB)
        const brillo = (r + g + b) / 3;

        if (brillo < umbralOscuro) {
          pixelesOscuros++;
        }
      }
    }

    return pixelesTotales > 0 ? pixelesOscuros / pixelesTotales : 0;
  }

  /**
   * Carga una imagen desde un File y retorna su ImageData
   */
  private cargarImagenComoImageData(file: File): Promise<ImageData> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();

      reader.onload = () => {
        img.onload = () => {
          // Crear canvas y dibujar imagen redimensionada
          const canvas = document.createElement('canvas');
          // Redimensionar para procesamiento más rápido (máx 800px)
          const maxDimension = 800;
          let ancho = img.width;
          let alto = img.height;

          if (ancho > maxDimension || alto > maxDimension) {
            const ratio = Math.min(maxDimension / ancho, maxDimension / alto);
            ancho = Math.floor(ancho * ratio);
            alto = Math.floor(alto * ratio);
          }

          canvas.width = ancho;
          canvas.height = alto;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject('No se pudo crear el contexto del canvas');
            return;
          }

          ctx.drawImage(img, 0, 0, ancho, alto);
          const imageData = ctx.getImageData(0, 0, ancho, alto);
          resolve(imageData);
        };
        img.onerror = () => reject('Error al cargar la imagen');
        img.src = reader.result as string;
      };

      reader.onerror = () => reject('Error al leer el archivo');
      reader.readAsDataURL(file);
    });
  }

  // ============================================================
  //   MÉTODOS PÚBLICOS
  // ============================================================

  /**
   * Guarda el balotario (responde correctas)
   * Acepta: TXT, DOC, DOCX (como texto) y JPG, PNG (como imagen de burbujas)
   */
  guardarBalotario(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const nombre = file.name.toLowerCase();

      // Si es imagen - guardar y mostrar mensaje
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = () => {
          this.balotarioBase64 = reader.result as string;
          this.nombreBalotario = file.name;
          // Las respuestas se asignarán desde balotario en texto
          resolve('Imagen del balotario guardada. Usa un archivo TXT con las respuestas correctas para la correccion.');
        };
        reader.readAsDataURL(file);
        return;
      }

      // Si es texto - extraer respuestas
      const reader = new FileReader();
      reader.onload = (e: any) => {
        const contenido = e.target.result as string;
        this.nombreBalotario = file.name;
        this.balotarioRespuestas = this.extraerRespuestas(contenido);
        this.totalPreguntas = this.balotarioRespuestas.length;

        if (this.totalPreguntas === 0) {
          reject('No se encontraron respuestas. Usa letras A, B, C, D (ej: 1A 2C 3B)');
          return;
        }

        resolve(`Balotario cargado: ${this.totalPreguntas} preguntas`);
      };

      reader.onerror = () => reject('Error al leer el archivo');
      reader.readAsText(file);
    });
  }

  obtenerBalotario(): { respuestas: string[]; nombre: string } {
    return {
      respuestas: this.balotarioRespuestas,
      nombre: this.nombreBalotario
    };
  }

  hayBalotario(): boolean {
    return this.balotarioRespuestas.length > 0;
  }

  /**
   * Corrige el examen usando OMR para imágenes o texto para archivos
   */
  async corregirExamen(file: File): Promise<ResultadoCorreccion> {
    // Si es imagen - usar OMR
    if (file.type.startsWith('image/')) {
      return this.corregirConOMR(file);
    }

    // Si es texto - usar comparación de texto
    return this.corregirConTexto(file);
  }

  /**
   * Corrección usando OMR (visión artificial) para imágenes de hojas de burbujas
   */
  private async corregirConOMR(file: File): Promise<ResultadoCorreccion> {
    try {
      // Cargar imagen y obtener data de pixeles
      const imageData = await this.cargarImagenComoImageData(file);

      // Analizar con OMR
      const respuestasAlumno = await this.analizarImagenOMR(imageData);

      // Comparar con balotario
      return this.compararRespuestas(respuestasAlumno, file.name);

    } catch (error: any) {
      return {
        correctas: 0,
        incorrectas: 0,
        nota: 0,
        detalle: 'Error al procesar imagen: ' + (error.message || error),
        respuestas: '',
        respuestasDetectadas: []
      };
    }
  }

  /**
   * Corrección usando comparación de texto (para TXT, DOC, DOCX)
   */
  private corregirConTexto(file: File): Promise<ResultadoCorreccion> {
    return new Promise((resolve) => {
      const reader = new FileReader();

      reader.onload = (e: any) => {
        const contenido = e.target.result as string;
        const respuestasAlumno = this.extraerRespuestas(contenido);
        resolve(this.compararRespuestas(respuestasAlumno, file.name));
      };

      reader.onerror = () => {
        resolve({
          correctas: 0,
          incorrectas: 0,
          nota: 0,
          detalle: 'Error al leer el archivo',
          respuestas: '',
          respuestasDetectadas: []
        });
      };

      reader.readAsText(file);
    });
  }

  /**
   * Compara las respuestas del alumno contra el balotario
   */
  private compararRespuestas(respuestasAlumno: string[], nombreArchivo: string): ResultadoCorreccion {
    let correctas = 0;
    let incorrectas = 0;
    const detalleLineas: string[] = [];
    const totalComparar = Math.min(this.balotarioRespuestas.length, respuestasAlumno.length);

    for (let i = 0; i < totalComparar; i++) {
      const numPregunta = i + 1;
      const respCorrecta = this.balotarioRespuestas[i];
      const respAlumno = respuestasAlumno[i];

      if (!respAlumno) {
        incorrectas++;
        detalleLineas.push(`Pregunta ${numPregunta}: SIN MARCA (debía ser ${respCorrecta})`);
      } else if (respAlumno === respCorrecta) {
        correctas++;
        detalleLineas.push(`Pregunta ${numPregunta}: ✅ ${respAlumno}`);
      } else {
        incorrectas++;
        detalleLineas.push(`Pregunta ${numPregunta}: ❌ ${respAlumno} (debía ser ${respCorrecta})`);
      }
    }

    // Preguntas extras detectadas
    if (respuestasAlumno.length > this.balotarioRespuestas.length) {
      for (let i = this.balotarioRespuestas.length; i < respuestasAlumno.length; i++) {
        incorrectas++;
        detalleLineas.push(`Pregunta ${i + 1}: ❌ ${respuestasAlumno[i]} (no está en balotario)`);
      }
    }

    // Preguntas no respondidas
    if (respuestasAlumno.length < this.balotarioRespuestas.length) {
      for (let i = respuestasAlumno.length; i < this.balotarioRespuestas.length; i++) {
        incorrectas++;
        detalleLineas.push(`Pregunta ${i + 1}: ❌ Sin respuesta (debía ser ${this.balotarioRespuestas[i]})`);
      }
    }

    const nota = this.totalPreguntas > 0
      ? Math.round((correctas / this.totalPreguntas) * 20 * 100) / 100
      : 0;

    const resumen = `📊 RESULTADOS
━━━━━━━━━━━━━━━━━━
Total preguntas: ${this.totalPreguntas}
✅ Correctas: ${correctas}
❌ Incorrectas: ${incorrectas}
🎯 Nota: ${nota}/${20}
━━━━━━━━━━━━━━━━━━`;

    return {
      correctas,
      incorrectas,
      nota,
      detalle: resumen + '\n\n--- DETALLE POR PREGUNTA ---\n' + detalleLineas.join('\n'),
      respuestas: respuestasAlumno.filter(r => r).join(', '),
      respuestasDetectadas: respuestasAlumno
    };
  }
}
