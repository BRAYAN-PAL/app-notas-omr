import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Preferences } from '@capacitor/preferences';
import { lastValueFrom } from 'rxjs';

export interface ResultadoBalotario {
  estado: string;
  archivo: string;
  total_preguntas: number;
  respuestas: string[];
}

export interface DetallePregunta {
  pregunta: number;
  respuesta_alumno: string;
  respuesta_correcta: string;
  resultado: string;
}

export interface ResultadoCorreccion {
  examen: string;
  balotario: string;
  total_preguntas: number;
  correctas: number;
  incorrectas: number;
  nota: number;
  nota_maxima: number;
  porcentaje: number;
  respuestas_alumno: string[];
  respuestas_correctas: string[];
  detalle: DetallePregunta[];
}

@Injectable({
  providedIn: 'root'
})
export class ApiService {

  private apiBase = '';
  private readonly initPromise: Promise<void>;

  constructor(private http: HttpClient) {
    this.initPromise = this.cargarIpGuardada();
  }

  private async ensureReady() {
    await this.initPromise;
  }

  private async cargarIpGuardada() {
    const { value } = await Preferences.get({ key: 'servidor_ip' });
    if (value) {
      this.apiBase = this.construirBaseUrl(value);
    } else {
      const defaultIp = this.obtenerIpPorDefecto();
      this.apiBase = this.construirBaseUrl(defaultIp);
    }
  }

  private construirBaseUrl(servidor: string): string {
    // Si tiene puntos y NO es una IP local, usar HTTPS
    const esDominioRemoto = servidor.includes('.') && 
      !servidor.startsWith('192.168.') && 
      !servidor.startsWith('10.') && 
      !servidor.startsWith('172.') &&
      servidor !== '127.0.0.1' &&
      servidor !== 'localhost';

    if (esDominioRemoto) {
      return `https://${servidor}`;
    }
    return `http://${servidor}:8000`;
  }

  private obtenerIpPorDefecto(): string {
    const host = window?.location?.hostname?.trim();
    if (
      host &&
      host !== 'localhost' &&
      host !== '127.0.0.1' &&
      host !== '0.0.0.0'
    ) {
      return host;
    }
    return '127.0.0.1';
  }

  async setIp(ip: string) {
    await Preferences.set({ key: 'servidor_ip', value: ip });
    this.apiBase = this.construirBaseUrl(ip);
  }

  async getIp(): Promise<string> {
    await this.ensureReady();
    const { value } = await Preferences.get({ key: 'servidor_ip' });
    return value || this.obtenerIpPorDefecto();
  }

  private getBaseUrl(): string {
    if (!this.apiBase) {
      this.apiBase = `http://${this.obtenerIpPorDefecto()}:8000`;
    }
    return this.apiBase;
  }

  /**
   * Verifica que el servidor esté funcionando
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.ensureReady();
      const result: any = await lastValueFrom(
        this.http.get(`${this.getBaseUrl()}/health`)
      );
      return result?.estado === 'ok';
    } catch {
      return false;
    }
  }

  /**
   * Carga el balotario (archivo TXT con respuestas correctas)
   */
  async cargarBalotario(file: File): Promise<ResultadoBalotario> {
    await this.ensureReady();
    const formData = new FormData();
    formData.append('file', file, file.name);
    return lastValueFrom(
      this.http.post<ResultadoBalotario>(
        `${this.getBaseUrl()}/cargar-balotario`,
        formData
      )
    );
  }

  /**
   * Corrige un examen (imagen con burbujas o archivo TXT)
   */
  async corregir(file: File): Promise<ResultadoCorreccion> {
    await this.ensureReady();
    const formData = new FormData();
    formData.append('file', file, file.name);
    return lastValueFrom(
      this.http.post<ResultadoCorreccion>(
        `${this.getBaseUrl()}/corregir`,
        formData
      )
    );
  }
}
