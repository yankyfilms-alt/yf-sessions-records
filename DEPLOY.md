# Publicar YF Sessions Records

## Opcion recomendada: Render

Esta app necesita servidor Node porque tiene dashboard, login, formularios, contactos, clicks y estadisticas.

### 1. Subir a GitHub

```powershell
cd "E:\PROYECTO CODEX\YF SESSIONS PLAYLIST"
git init
git add .
git commit -m "Publicar YF Sessions Records"
git branch -M main
git remote add origin TU_REPO_GITHUB
git push -u origin main
```

### 2. Crear servicio en Render

Abre:

```text
https://dashboard.render.com/blueprint/new
```

Selecciona el repo y Render detectara `render.yaml`.

### 3. Variables secretas

Render pedira estos valores:

- `ADMIN_PASSWORD`: contraseña privada del dashboard.
- `ADMIN_PASSWORD_SALT`: texto largo aleatorio para cifrar la contraseña.

Ejemplo de salt:

```text
yf-sessions-records-2026-cambia-esto-por-un-texto-largo
```

### 4. URL final

Cuando Render termine, la web quedara en una URL parecida a:

```text
https://yf-sessions-records.onrender.com/yf-sessions-web.html
```

El dashboard privado:

```text
https://yf-sessions-records.onrender.com/yf-sessions-web.html#admin
```

### Nota importante

El plan gratis de Render puede dormir cuando no hay visitas. Para datos persistentes reales a largo plazo conviene usar una base de datos gestionada o un disco persistente de pago.
