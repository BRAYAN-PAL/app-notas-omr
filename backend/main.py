"""
SISTEMA OMR - RECONOCIMIENTO ÓPTICO DE MARCAS
Corrector de Exámenes Universitarios
Backend en Python con FastAPI + OpenCV
"""

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import cv2
import numpy as np
import io
import os
import re
import shutil
import tempfile
from pathlib import Path
from typing import List, Optional

app = FastAPI(
    title="Sistema OMR - Corrector de Exámenes",
    description="API de Reconocimiento Óptico de Marcas para automatización de calificaciones",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).resolve().parent
UPLOADS_DIR = BASE_DIR / "uploads"
PROCESADAS_DIR = BASE_DIR / "procesadas"

UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
PROCESADAS_DIR.mkdir(parents=True, exist_ok=True)

OMR_MAX_PREGUNTAS = 60
OMR_OPCIONES = 5


def nombre_archivo_seguro(nombre: str, prefijo: str) -> str:
    """Genera un nombre de archivo seguro para evitar traversal e inputs extraños."""
    base = os.path.basename(nombre or "")
    limpio = re.sub(r'[^A-Za-z0-9._-]+', '_', base).strip('._')
    if not limpio:
        limpio = "archivo"
    return f"{prefijo}_{limpio}"


def ordenar_puntos(pts: np.ndarray) -> np.ndarray:
    """Ordena 4 puntos en orden: arriba-izq, arriba-der, abajo-der, abajo-izq."""
    rect = np.zeros((4, 2), dtype="float32")
    suma = pts.sum(axis=1)
    rect[0] = pts[np.argmin(suma)]
    rect[2] = pts[np.argmax(suma)]

    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]
    return rect


def corregir_perspectiva_hoja(imagen: np.ndarray) -> np.ndarray:
    """Intenta detectar la hoja del examen y la corrige por perspectiva."""
    gris = cv2.cvtColor(imagen, cv2.COLOR_BGR2GRAY)
    gris = cv2.GaussianBlur(gris, (5, 5), 0)
    bordes = cv2.Canny(gris, 75, 200)

    contornos, _ = cv2.findContours(bordes, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    contornos = sorted(contornos, key=cv2.contourArea, reverse=True)[:10]

    hoja = None
    for contorno in contornos:
        perimetro = cv2.arcLength(contorno, True)
        aproximado = cv2.approxPolyDP(contorno, 0.02 * perimetro, True)
        if len(aproximado) == 4:
            hoja = aproximado.reshape(4, 2).astype("float32")
            break

    if hoja is None:
        return imagen

    rect = ordenar_puntos(hoja)
    (tl, tr, br, bl) = rect

    ancho_a = np.linalg.norm(br - bl)
    ancho_b = np.linalg.norm(tr - tl)
    alto_a = np.linalg.norm(tr - br)
    alto_b = np.linalg.norm(tl - bl)

    max_ancho = max(int(ancho_a), int(ancho_b))
    max_alto = max(int(alto_a), int(alto_b))

    if max_ancho < 200 or max_alto < 200:
        return imagen

    destino = np.array([
        [0, 0],
        [max_ancho - 1, 0],
        [max_ancho - 1, max_alto - 1],
        [0, max_alto - 1]
    ], dtype="float32")

    matriz = cv2.getPerspectiveTransform(rect, destino)
    corregida = cv2.warpPerspective(imagen, matriz, (max_ancho, max_alto))
    return corregida

# ============================================================================
#   ALMACENAMIENTO DEL BALOTARIO EN MEMORIA
# ============================================================================

balotario_actual = {
    "respuestas": [],
    "total_preguntas": 0,
    "nombre_archivo": ""
}

# ============================================================================
#   FUNCIONES DE PROCESAMIENTO DE IMÁGENES (VISIÓN ARTIFICIAL)
# ============================================================================

def preprocesar_imagen(ruta_imagen: str) -> np.ndarray:
    """
    Carga y preprocesa una imagen para OMR:
    - Redimensiona manteniendo proporción
    - Convierte a escala de grises
    - Aplica desenfoque Gaussiano para reducir ruido
    - Binarización adaptativa
    - Operaciones morfológicas para limpiar
    """
    img = cv2.imread(ruta_imagen)
    if img is None:
        raise ValueError(f"No se pudo cargar la imagen: {ruta_imagen}")

    # Escalar a tamaño estándar (ancho 1200px manteniendo proporción)
    alto, ancho = img.shape[:2]
    escala = 1200 / ancho
    nuevo_ancho = 1200
    nuevo_alto = int(alto * escala)
    img = cv2.resize(img, (nuevo_ancho, nuevo_alto))

    # Corregir perspectiva de la hoja si se logra detectar contorno principal
    img = corregir_perspectiva_hoja(img)

    # Escala de grises
    gris = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Desenfoque Gaussiano más fuerte para fotos de celular
    gris = cv2.GaussianBlur(gris, (7, 7), 0)

    # Binarización adaptativa con parámetros más tolerantes
    binaria = cv2.adaptiveThreshold(
        gris, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        15, 3  # Reducido de (21,5) a (15,3) para detectar más
    )

    # Operaciones morfológicas para limpiar ruido
    kernel = np.ones((3, 3), np.uint8)
    binaria = cv2.morphologyEx(binaria, cv2.MORPH_OPEN, kernel)
    # Cerrar pequeños huecos
    binaria = cv2.morphologyEx(binaria, cv2.MORPH_CLOSE, kernel)

    return binaria


def detectar_burbujas(imagen_binaria: np.ndarray) -> List[dict]:
    """
    Detecta todas las burbujas (círculos) en la hoja de examen.
    Usa HoughCircles como alternativa para detectar círculos aunque estén
    parcialmente rellenos o borrosos.
    Retorna lista de diccionarios con posición y radio.
    """
    burbujas = []
    alto, ancho = imagen_binaria.shape
    area_total = ancho * alto

    # Método 1: Detección por contornos (circularidad)
    contornos, _ = cv2.findContours(
        imagen_binaria,
        cv2.RETR_EXTERNAL,
        cv2.CHAIN_APPROX_SIMPLE
    )

    for contorno in contornos:
        area = cv2.contourArea(contorno)

        # Filtrar por área: entre 0.02% y 5% del área total (más tolerante)
        area_min = area_total * 0.0002   # 0.02%
        area_max = area_total * 0.05     # 5%

        if area < area_min or area > area_max:
            continue

        # Calcular circularidad (más tolerante: > 0.3)
        perimetro = cv2.arcLength(contorno, True)
        if perimetro == 0:
            continue

        circularidad = 4 * np.pi * area / (perimetro * perimetro)

        if circularidad < 0.3:
            continue

        # Obtener centro y radio
        (x, y), radio = cv2.minEnclosingCircle(contorno)

        burbujas.append({
            "x": int(x),
            "y": int(y),
            "radio": max(int(radio), 3),
            "area": area,
            "circularidad": circularidad
        })

    # Método 2: Si no se detectaron suficientes burbujas, usar HoughCircles
    if len(burbujas) < 5:
        # Invertir la imagen para HoughCircles (necesita bordes blancos sobre fondo negro)
        inverted = cv2.bitwise_not(imagen_binaria)
        circles = cv2.HoughCircles(
            inverted,
            cv2.HOUGH_GRADIENT,
            dp=1.2,
            minDist=15,
            param1=50,
            param2=20,
            minRadius=5,
            maxRadius=50
        )

        if circles is not None:
            circles = np.round(circles[0, :]).astype("int")
            for (x, y, r) in circles:
                # Verificar que no esté duplicado
                duplicado = False
                for b in burbujas:
                    if abs(b["x"] - x) < 10 and abs(b["y"] - y) < 10:
                        duplicado = True
                        break
                if not duplicado:
                    burbujas.append({
                        "x": x,
                        "y": y,
                        "radio": r,
                        "area": np.pi * r * r,
                        "circularidad": 1.0
                    })

    return burbujas


def agrupar_burbujas_por_pregunta(
    burbujas: List[dict],
    num_preguntas: int,
    num_opciones: int = 5
) -> List[List[dict]]:
    """
    Agrupa las burbujas detectadas en filas (preguntas) y columnas (opciones).
    Las ordena por posición vertical (Y) primero y horizontal (X) después.
    Versión mejorada para fotos de celular.
    """
    if not burbujas:
        return []

    # Ordenar burbujas por Y (fila)
    burbujas_ordenadas = sorted(burbujas, key=lambda b: b["y"])

    # Calcular tolerancia vertical basada en la mediana de diferencias Y
    if len(burbujas_ordenadas) > 1:
        diffs_y = [abs(burbujas_ordenadas[i+1]["y"] - burbujas_ordenadas[i]["y"])
                   for i in range(len(burbujas_ordenadas)-1)]
        diff_mediana = float(np.median(diffs_y)) if diffs_y else 20
        tolerancia_y = max(15, int(diff_mediana * 0.6))
    else:
        tolerancia_y = 20

    # Agrupar en filas según proximidad vertical
    filas = []
    fila_actual = [burbujas_ordenadas[0]]

    for burbuja in burbujas_ordenadas[1:]:
        if abs(burbuja["y"] - fila_actual[-1]["y"]) < tolerancia_y:
            fila_actual.append(burbuja)
        else:
            fila_actual.sort(key=lambda b: b["x"])
            filas.append(fila_actual)
            fila_actual = [burbuja]

    if fila_actual:
        fila_actual.sort(key=lambda b: b["x"])
        filas.append(fila_actual)

    # Tomar solo las primeras 'num_preguntas' filas
    filas = filas[:num_preguntas]

    # Para cada fila, tomar las primeras 'num_opciones' burbujas
    resultado = []
    for fila in filas:
        resultado.append(fila[:num_opciones])

    return resultado


def analizar_burbujas_rellenas(
    imagen_binaria: np.ndarray,
    burbujas_agrupadas: List[List[dict]],
    umbral_relleno: float = 0.25  # Reducido de 0.4 a 0.25
) -> List[str]:
    """
    Analiza cada grupo de burbujas para determinar cuál está rellena.
    Retorna las letras de las opciones seleccionadas (A, B, C, D, E).
    """
    opciones_letras = ['A', 'B', 'C', 'D', 'E', 'F']
    respuestas = []

    for fila in burbujas_agrupadas:
        mejor_opcion = ''
        mejor_relleno = 0

        for idx, burbuja in enumerate(fila):
            if idx >= len(opciones_letras):
                break

            x, y, radio = burbuja["x"], burbuja["y"], burbuja["radio"]

            # Crear máscara circular para la burbuja
            mascara = np.zeros(imagen_binaria.shape, dtype=np.uint8)
            cv2.circle(mascara, (x, y), radio, 255, -1)

            # Contar píxeles blancos (relleno) dentro de la máscara
            pixeles_en_mascara = cv2.countNonZero(mascara)
            if pixeles_en_mascara == 0:
                continue

            pixeles_relleno = cv2.countNonZero(
                cv2.bitwise_and(imagen_binaria, mascara)
            )

            nivel_relleno = pixeles_relleno / pixeles_en_mascara

            if nivel_relleno > mejor_relleno:
                mejor_relleno = nivel_relleno
                mejor_opcion = opciones_letras[idx] if nivel_relleno > umbral_relleno else ''

        respuestas.append(mejor_opcion)

    return respuestas


def procesar_omr(
    ruta_imagen: str,
    num_preguntas: int = 10,
    num_opciones: int = OMR_OPCIONES,
    umbral_relleno: float = 0.4
) -> List[str]:
    """
    Pipeline completo de OMR:
    1. Preprocesar imagen
    2. Detectar burbujas
    3. Agrupar por pregunta
    4. Analizar relleno
    5. Retornar respuestas
    """
    print(f"[OMR] Procesando imagen: {ruta_imagen}")
    print(f"[OMR] Preguntas esperadas: {num_preguntas}")
    print(f"[OMR] Opciones por pregunta: {num_opciones}")

    # 1. Preprocesar
    img_bin = preprocesar_imagen(ruta_imagen)

    # Guardar imagen procesada para depuración
    ruta_base, extension = os.path.splitext(ruta_imagen)
    ruta_procesada = f"{ruta_base}_binaria{extension}"
    ruta_procesada = ruta_procesada.replace(str(UPLOADS_DIR), str(PROCESADAS_DIR))
    cv2.imwrite(ruta_procesada, img_bin)
    print(f"[OMR] Imagen binarizada guardada: {ruta_procesada}")

    # 2. Detectar burbujas
    burbujas = detectar_burbujas(img_bin)
    print(f"[OMR] Burbujas detectadas: {len(burbujas)}")

    if len(burbujas) < num_preguntas:
        print(f"[OMR] ADVERTENCIA: Se detectaron pocas burbujas ({len(burbujas)})")

    # 3. Agrupar por pregunta
    burbujas_agrupadas = agrupar_burbujas_por_pregunta(
        burbujas,
        num_preguntas,
        num_opciones=num_opciones
    )
    print(f"[OMR] Grupos de preguntas: {len(burbujas_agrupadas)}")

    if len(burbujas_agrupadas) == 0:
        raise ValueError("No se pudieron agrupar burbujas por pregunta")

    # 4. Analizar relleno
    respuestas = analizar_burbujas_rellenas(
        img_bin,
        burbujas_agrupadas,
        umbral_relleno=umbral_relleno
    )
    respuestas = respuestas[:num_preguntas]
    if len(respuestas) < num_preguntas:
        respuestas.extend([""] * (num_preguntas - len(respuestas)))
    print(f"[OMR] Respuestas detectadas: {respuestas}")

    return respuestas


# ============================================================================
#   FUNCIONES DE PROCESAMIENTO DE TEXTO
# ============================================================================

def extraer_respuestas_de_texto(texto: str) -> List[str]:
    """
    Extrae letras de respuestas (A, B, C, D) de un texto.
    Ejemplos:
      "1A 2C 3B 4D" -> ["A", "C", "B", "D"]
      "A,B,C,D" -> ["A", "B", "C", "D"]
      "1.-A 2.-B" -> ["A", "B"]
    """
    # Solo tomar letras mayúsculas A-F
    respuestas = re.findall(r'[ABCDEF]', texto.upper())
    return respuestas


def extraer_texto_pdf(contenido: bytes) -> str:
    """Extrae texto plano desde un PDF en memoria."""
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise ValueError(
            "Para subir PDF instala la dependencia pypdf en el backend"
        ) from exc

    lector = PdfReader(io.BytesIO(contenido))
    textos = []
    for pagina in lector.pages:
        textos.append(pagina.extract_text() or "")

    return "\n".join(textos)


def extraer_texto_docx(contenido: bytes) -> str:
    """Extrae texto plano desde un DOCX en memoria."""
    try:
        from docx import Document
    except ImportError as exc:
        raise ValueError(
            "Para subir Word instala la dependencia python-docx en el backend"
        ) from exc

    ruta_temp = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".docx") as tmp:
            tmp.write(contenido)
            ruta_temp = tmp.name

        documento = Document(ruta_temp)
        return "\n".join([parrafo.text for parrafo in documento.paragraphs])
    finally:
        if ruta_temp and os.path.exists(ruta_temp):
            os.remove(ruta_temp)


def extraer_respuestas_balotario(
    nombre_archivo: str,
    contenido: bytes,
    ruta_archivo: Path
) -> List[str]:
    """Extrae respuestas del balotario desde texto, PDF, DOCX o imagen OMR."""
    nombre = nombre_archivo.lower()

    if nombre.endswith((".jpg", ".jpeg", ".png")):
        # Para imágenes/fotos del balotario se intenta lectura OMR con varios ajustes.
        estrategias_omr = [
            {"num_opciones": OMR_OPCIONES, "umbral_relleno": 0.20},
            {"num_opciones": OMR_OPCIONES, "umbral_relleno": 0.15},
            {"num_opciones": OMR_OPCIONES, "umbral_relleno": 0.10},
        ]

        mejor_respuesta: List[str] = []
        ultimo_error: Optional[str] = None

        for estrategia in estrategias_omr:
            try:
                detectadas = procesar_omr(
                    str(ruta_archivo),
                    num_preguntas=OMR_MAX_PREGUNTAS,
                    num_opciones=estrategia["num_opciones"],
                    umbral_relleno=estrategia["umbral_relleno"]
                )
                respuestas_intento = [r for r in detectadas if r]
                if len(respuestas_intento) > len(mejor_respuesta):
                    mejor_respuesta = respuestas_intento
            except Exception as exc:
                ultimo_error = str(exc)

        respuestas = mejor_respuesta

        if len(respuestas) == 0:
            detalle = "No se detectaron marcas en la imagen"
            if ultimo_error:
                detalle += f" ({ultimo_error})"
            raise ValueError(
                f"{detalle}. Toma la foto de frente, con buena luz y mostrando toda la hoja OMR"
            )

        if len(respuestas) < 5:
            raise ValueError(
                "Se detectaron muy pocas respuestas en la foto. Asegura enfoque, hoja completa y marcas oscuras"
            )
    else:
        if nombre.endswith(".pdf"):
            texto = extraer_texto_pdf(contenido)
        elif nombre.endswith(".docx"):
            texto = extraer_texto_docx(contenido)
        else:
            texto = contenido.decode("utf-8", errors="ignore")

        respuestas = extraer_respuestas_de_texto(texto)

    if len(respuestas) == 0:
        raise ValueError(
            "No se encontraron respuestas válidas. Usa letras A-F en texto o una foto clara del balotario OMR"
        )

    return respuestas


# ============================================================================
#   ENDPOINTS DE LA API
# ============================================================================

@app.get("/")
async def root():
    return {
        "nombre": "Sistema OMR - Corrector de Exámenes",
        "version": "1.0.0",
        "estado": "funcionando",
        "tecnologia": "Visión Artificial con OpenCV"
    }


@app.get("/health")
async def health():
    return {
        "estado": "ok",
        "servidor": "Sistema OMR",
        "opencv_version": cv2.__version__
    }


@app.post("/cargar-balotario")
async def cargar_balotario(file: UploadFile = File(...)):
    """
    Carga el balotario (respuestas correctas).
    Acepta TXT/PDF/Word e imágenes de hoja OMR.
    """
    global balotario_actual

    if not file.filename:
        raise HTTPException(status_code=400, detail="No se envió ningún archivo")

    # Guardar archivo
    nombre_seguro = nombre_archivo_seguro(file.filename, "balotario")
    ruta = UPLOADS_DIR / nombre_seguro
    contenido = await file.read()

    with open(ruta, "wb") as buffer:
        buffer.write(contenido)

    try:
        respuestas = extraer_respuestas_balotario(file.filename, contenido, ruta)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if len(respuestas) > OMR_MAX_PREGUNTAS:
        raise HTTPException(
            status_code=400,
            detail=f"El balotario excede el máximo de {OMR_MAX_PREGUNTAS} preguntas"
        )

    # Guardar en memoria
    balotario_actual = {
        "respuestas": respuestas,
        "total_preguntas": len(respuestas),
        "nombre_archivo": file.filename
    }

    return {
        "estado": "Balotario cargado correctamente",
        "archivo": file.filename,
        "total_preguntas": len(respuestas),
        "respuestas": respuestas
    }


@app.get("/balotario")
async def obtener_balotario():
    """Obtiene el balotario actualmente cargado."""
    return {
        "cargado": len(balotario_actual["respuestas"]) > 0,
        "total_preguntas": balotario_actual["total_preguntas"],
        "respuestas": balotario_actual["respuestas"],
        "archivo": balotario_actual["nombre_archivo"]
    }


@app.post("/corregir")
async def corregir_examen(file: UploadFile = File(...)):
    """
    Corrige un examen usando OMR (Visión Artificial).
    Acepta imágenes de hojas de burbujas (JPG, PNG).
    """
    global balotario_actual

    if not file.filename:
        raise HTTPException(status_code=400, detail="No se envió ningún archivo")

    if not balotario_actual["respuestas"]:
        raise HTTPException(
            status_code=400,
            detail="Primero debes cargar un balotario usando /cargar-balotario"
        )

    nombre = file.filename.lower()
    respuestas_correctas = balotario_actual["respuestas"]
    num_preguntas = len(respuestas_correctas)

    # Guardar archivo subido
    nombre_seguro = nombre_archivo_seguro(file.filename, "examen")
    ruta = UPLOADS_DIR / nombre_seguro
    contenido = await file.read()

    with open(ruta, "wb") as buffer:
        buffer.write(contenido)

    respuestas_alumno = []

    # Determinar si es imagen o texto
    if nombre.endswith(('.jpg', '.jpeg', '.png')):
        # === PROCESAMIENTO OMR CON VISIÓN ARTIFICIAL ===
        print(f"[API] Procesando imagen con OMR: {file.filename}")

        try:
            respuestas_alumno = procesar_omr(str(ruta), num_preguntas)
        except Exception as e:
            print(f"[API] Error en OMR: {e}")
            return JSONResponse(
                status_code=500,
                content={
                    "error": f"Error al procesar la imagen: {str(e)}",
                    "detalle": "La imagen podría no tener el formato esperado"
                }
            )
    else:
        # === PROCESAMIENTO DE TEXTO ===
        texto = contenido.decode('utf-8', errors='ignore')
        respuestas_alumno = extraer_respuestas_de_texto(texto)
        print(f"[API] Procesando texto: {file.filename} -> {respuestas_alumno}")

    # ========================================================
    #   CORRECCIÓN: COMPARAR RESPUESTAS
    # ========================================================

    correctas = 0
    incorrectas = 0
    detalle_preguntas = []

    total_comparar = min(len(respuestas_correctas), len(respuestas_alumno))

    for i in range(total_comparar):
        num_preg = i + 1
        resp_correcta = respuestas_correctas[i]
        resp_alumno = respuestas_alumno[i]

        if not resp_alumno:
            incorrectas += 1
            detalle_preguntas.append({
                "pregunta": num_preg,
                "respuesta_alumno": "",
                "respuesta_correcta": resp_correcta,
                "resultado": "SIN MARCA"
            })
        elif resp_alumno == resp_correcta:
            correctas += 1
            detalle_preguntas.append({
                "pregunta": num_preg,
                "respuesta_alumno": resp_alumno,
                "respuesta_correcta": resp_correcta,
                "resultado": "CORRECTA"
            })
        else:
            incorrectas += 1
            detalle_preguntas.append({
                "pregunta": num_preg,
                "respuesta_alumno": resp_alumno,
                "respuesta_correcta": resp_correcta,
                "resultado": "INCORRECTA"
            })

    # Preguntas extras (no deberían existir)
    if len(respuestas_alumno) > len(respuestas_correctas):
        for i in range(len(respuestas_correctas), len(respuestas_alumno)):
            incorrectas += 1
            detalle_preguntas.append({
                "pregunta": i + 1,
                "respuesta_alumno": respuestas_alumno[i],
                "respuesta_correcta": "N/A",
                "resultado": "EXTRA (no está en balotario)"
            })

    # Preguntas faltantes
    if len(respuestas_alumno) < len(respuestas_correctas):
        for i in range(len(respuestas_alumno), len(respuestas_correctas)):
            incorrectas += 1
            detalle_preguntas.append({
                "pregunta": i + 1,
                "respuesta_alumno": "",
                "respuesta_correcta": respuestas_correctas[i],
                "resultado": "SIN RESPUESTA"
            })

    # Calcular nota (escala 0-20)
    nota = round((correctas / num_preguntas) * 20, 2) if num_preguntas > 0 else 0

    return {
        "examen": file.filename,
        "balotario": balotario_actual["nombre_archivo"],
        "total_preguntas": num_preguntas,
        "correctas": correctas,
        "incorrectas": incorrectas,
        "nota": nota,
        "nota_maxima": 20,
        "porcentaje": round((correctas / num_preguntas) * 100, 1) if num_preguntas > 0 else 0,
        "respuestas_alumno": respuestas_alumno,
        "respuestas_correctas": respuestas_correctas,
        "detalle": detalle_preguntas
    }


@app.get("/procesadas/{nombre_archivo}")
async def obtener_imagen_procesada(nombre_archivo: str):
    """Sirve las imágenes procesadas (binarizadas) para depuración."""
    from fastapi.responses import FileResponse
    nombre = os.path.basename(nombre_archivo)
    ruta = PROCESADAS_DIR / nombre
    if ruta.exists():
        return FileResponse(str(ruta), media_type="image/png")
    return JSONResponse(
        status_code=404,
        content={"error": "Imagen no encontrada"}
    )


# ============================================================================
#   INICIO DEL SERVIDOR
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    print("=" * 60)
    print("  SISTEMA OMR - RECONOCIMIENTO ÓPTICO DE MARCAS")
    print("  Corrector de Exámenes Universitarios")
    print("=" * 60)
    print(f"  OpenCV version: {cv2.__version__}")
    print(f"  Numpy version: {np.__version__}")
    print("=" * 60)
    uvicorn.run(app, host="0.0.0.0", port=8000)
