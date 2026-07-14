import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
  IonItem,
  IonLabel,
  IonInput,
  IonIcon,
  IonText,
  IonSpinner
} from '@ionic/angular/standalone';

import { ApiService } from '../services/api';

@Component({
  selector: 'app-configuracion',
  templateUrl: 'configuracion.page.html',
  styleUrls: ['configuracion.page.scss'],
  imports: [
    CommonModule,
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonButton,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonItem,
    IonLabel,
    IonInput,
    IonIcon,
    IonText,
    IonSpinner
  ]
})
export class ConfiguracionPage implements OnInit {

  ipServidor = '';
  mensajeError = '';
  mensajeExito = '';
  ipGuardada = false;
  probando = false;

  constructor(
    private api: ApiService,
    private router: Router
  ) {}

  async ngOnInit() {
    this.ipServidor = await this.api.getIp();
    this.ipGuardada = this.ipServidor !== '127.0.0.1';
  }

  validarServidor(servidor: string): boolean {
    // Acepta IPs (192.168.1.100) o dominios (ejemplo.onrender.com)
    const esIP = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(servidor);
    const esDominio = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/.test(servidor);

    if (esIP) {
      const partes = servidor.split('.');
      for (const parte of partes) {
        const num = parseInt(parte, 10);
        if (num < 0 || num > 255) return false;
      }
      return true;
    }

    return esDominio && servidor.includes('.');
  }

  async probarConexion() {
    this.mensajeError = '';
    this.mensajeExito = '';
    this.probando = true;

    const ip = this.ipServidor.trim();
    if (!ip || !this.validarServidor(ip)) {
      this.mensajeError = 'Ingresa una IP o dominio válido primero';
      this.probando = false;
      return;
    }

    await this.api.setIp(ip);
    const conectado = await this.api.healthCheck();
    this.probando = false;

    if (conectado) {
      this.mensajeExito = '✅ Conexión exitosa al servidor OMR';
      this.ipGuardada = true;
    } else {
      this.mensajeError = '❌ No se pudo conectar. Verifica la IP y que el servidor esté corriendo.';
    }
  }

  async guardarConfiguracion() {
    this.mensajeError = '';
    this.mensajeExito = '';

    const ip = this.ipServidor.trim();

    if (!ip) {
      this.mensajeError = 'Por favor ingresa una dirección IP.';
      return;
    }

    if (!this.validarServidor(ip)) {
      this.mensajeError = 'Formato inválido. Ejemplo: 192.168.1.100 o midominio.onrender.com';
      return;
    }

    await this.api.setIp(ip);
    this.mensajeExito = `✅ IP guardada: ${ip}`;
    this.ipGuardada = true;

    // Probar conexión automáticamente
    const conectado = await this.api.healthCheck();
    if (conectado) {
      this.mensajeExito += '\n✅ Servidor OMR detectado';
    } else {
      this.mensajeExito += '\n⚠️ Servidor no disponible. Configuración guardada.';
    }
  }

  async irAInicio() {
    this.router.navigate(['/home']);
  }
}
