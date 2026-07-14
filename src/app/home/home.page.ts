import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonButton,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  IonIcon,
  IonSpinner,
  IonButtons
} from '@ionic/angular/standalone';

import {
  Camera,
  CameraResultType,
  CameraSource
} from '@capacitor/camera';

import { ApiService, ResultadoBalotario, ResultadoCorreccion } from '../services/api';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  imports: [
    CommonModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonButton,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonIcon,
    IonSpinner,
    IonButtons
  ]
})
export class HomePage {

  mensaje = '';
  nota = '';
  cargando = false;
  hayBalotario = false;
  totalPreguntas = 0;
  respuestasBalotario = '';
  servidorConectado = false;

  constructor(
    private api: ApiService,
    private router: Router
  ) {}

  async ngOnInit() {
    await this.verificarServidor();
  }

  async ionViewWillEnter() {
    await this.verificarServidor();
  }

  private async verificarServidor() {
    this.servidorConectado = await this.api.healthCheck();
    if (this.servidorConectado) {
      if (this.mensaje.includes('Servidor OMR no disponible') || this.mensaje.includes('Conecta al servidor')) {
        this.mensaje = '';
      }
    } else {
      this.mensaje = '⚠️ Servidor OMR no disponible. Configura la IP.';
    }
  }

  irAConfiguracion() {
    this.router.navigate(['/configuracion']);
  }

  seleccionarBalotario(event: any) {
    const file = event.target.files[0];
    if (!file) return;
    this.procesarBalotario(file);
  }

  async procesarBalotario(file: File) {
    if (!this.servidorConectado) {
      await this.verificarServidor();
      if (!this.servidorConectado) {
        this.mensaje = 'Conecta al servidor primero (Configuracion)';
        return;
      }
    }

    this.cargando = true;
    try {
      const resultado = await this.api.cargarBalotario(file);
      this.mensaje = `Balotario cargado: ${resultado.total_preguntas} preguntas`;
      this.hayBalotario = true;
      this.totalPreguntas = resultado.total_preguntas;
      this.respuestasBalotario = resultado.respuestas.join(', ');
    } catch (error: any) {
      this.mensaje = 'Error: ' + (error.error?.detail || error.message || error);
    }
    this.cargando = false;
  }

  async tomarFotoBalotario() {
    try {
      const image = await Camera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: CameraSource.Camera
      });
      if (!image.webPath) return;
      const response = await fetch(image.webPath);
      const blob = await response.blob();
      const file = new File([blob], 'balotario_foto.jpg', { type: 'image/jpeg' });
      this.procesarBalotario(file);
    } catch (error) {
      console.error('Error al tomar foto del balotario', error);
    }
  }

  seleccionarExamen(event: any) {
    const file = event.target.files[0];
    if (!file) return;
    this.procesarExamen(file);
  }

  async tomarFotoExamen() {
    try {
      const image = await Camera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: CameraSource.Camera
      });
      if (!image.webPath) return;
      const response = await fetch(image.webPath);
      const blob = await response.blob();
      const file = new File([blob], 'examen_foto.jpg', { type: 'image/jpeg' });
      this.procesarExamen(file);
    } catch (error) {
      console.error('Error al tomar foto del examen', error);
    }
  }

  async procesarExamen(file: File) {
    if (!this.servidorConectado) {
      await this.verificarServidor();
      if (!this.servidorConectado) {
        this.mensaje = 'Conecta al servidor primero (Configuracion)';
        return;
      }
    }

    if (!this.hayBalotario) {
      this.mensaje = 'Primero carga un Balotario';
      return;
    }

    this.cargando = true;
    this.nota = '';
    try {
      const resultado = await this.api.corregir(file);

      // Formatear resultados
      let detalleHtml = `<div class="resumen">
        <div class="total">Total preguntas: ${resultado.total_preguntas}</div>
        <div class="correctas">Correctas: ${resultado.correctas}</div>
        <div class="incorrectas">Incorrectas: ${resultado.incorrectas}</div>
        <div class="nota-final">Nota: ${resultado.nota}/${resultado.nota_maxima} (${resultado.porcentaje}%)</div>
      </div>`;

      if (resultado.detalle && resultado.detalle.length > 0) {
        detalleHtml += `<div class="detalle-preguntas"><hr>`;
        for (const p of resultado.detalle) {
          const icono = p.resultado === 'CORRECTA' ? '✅' :
                       p.resultado === 'INCORRECTA' ? '❌' :
                       p.resultado === 'SIN MARCA' ? '⬜' : '⚠️';
          detalleHtml += `<div class="pregunta ${p.resultado.toLowerCase()}">
            ${icono} P${p.pregunta}: ${p.respuesta_alumno || '(sin marca)'}
            ${p.resultado !== 'CORRECTA' ? `<span class="correcta-era">(debía ser ${p.respuesta_correcta})</span>` : ''}
          </div>`;
        }
        detalleHtml += `</div>`;
      }

      this.nota = detalleHtml;
    } catch (error: any) {
      this.nota = 'Error al corregir: ' + (error.error?.detail || error.message || error);
    }
    this.cargando = false;
  }
}
