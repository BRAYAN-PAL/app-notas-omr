import urllib.request
import json
import os

# Crear archivo de prueba
with open('test_balotario.txt', 'w') as f:
    f.write('1A 2C 3B 4D 5A 6C 7B 8D 9A 10C')

# Subir balotario
boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW'
with open('test_balotario.txt', 'rb') as f:
    file_data = f.read()

body = (
    '--' + boundary + '\r\n' +
    'Content-Disposition: form-data; name="file"; filename="test_balotario.txt"\r\n' +
    'Content-Type: text/plain\r\n\r\n' +
    file_data.decode() + '\r\n' +
    '--' + boundary + '--\r\n'
).encode()

req = urllib.request.Request(
    'http://127.0.0.1:8000/cargar-balotario',
    data=body,
    headers={'Content-Type': 'multipart/form-data; boundary=' + boundary}
)
resp = urllib.request.urlopen(req)
resultado = json.loads(resp.read())
print('=== BALOTARIO CARGADO ===')
print(json.dumps(resultado, indent=2, ensure_ascii=False))

# Ahora crear un examen de prueba
with open('test_examen.txt', 'w') as f:
    f.write('1A 2C 3A 4D 5B 6C 7D 8B 9A 10C')

print('\n=== SUBIENDO EXAMEN ===')
with open('test_examen.txt', 'rb') as f:
    file_data2 = f.read()

body2 = (
    '--' + boundary + '\r\n' +
    'Content-Disposition: form-data; name="file"; filename="test_examen.txt"\r\n' +
    'Content-Type: text/plain\r\n\r\n' +
    file_data2.decode() + '\r\n' +
    '--' + boundary + '--\r\n'
).encode()

req2 = urllib.request.Request(
    'http://127.0.0.1:8000/corregir',
    data=body2,
    headers={'Content-Type': 'multipart/form-data; boundary=' + boundary}
)
resp2 = urllib.request.urlopen(req2)
resultado2 = json.loads(resp2.read())
print('\n=== RESULTADOS DE CORRECCIÓN ===')
print(json.dumps(resultado2, indent=2, ensure_ascii=False))

# Limpiar
os.remove('test_balotario.txt')
os.remove('test_examen.txt')
