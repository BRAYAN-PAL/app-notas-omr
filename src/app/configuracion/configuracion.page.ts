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

  validarIP(ip: string): boolean {
    const regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const match = ip.match(regex);
    if (!match) return false;
    for (let i = 1; i <= 4; i++) {
      const num = parseInt(match[i], 10);
      if (num < 0 || num > 255) return false;
    }
    return true;
  }

  async probarConexion() {
    this.mensajeError = '';
    this.mensajeExito = '';
    this.probando = true;

    const ip = this.ipServidor.trim();
    if (!ip || !this.validarIP(ip)) {
      this.mensajeError = 'Ingresa una IP válida primero';
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

    if (!this.validarIP(ip)) {
      this.mensajeError = 'Formato de IP inválido. Ejemplo: 192.168.1.100';
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
