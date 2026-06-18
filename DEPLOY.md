# Publicar YF Sessions Records

## Opcion recomendada: Render

Esta app necesita servidor Node porque tiene dashboard, login, formularios, contactos, clicks y estadisticas.

### 1. Repositorio GitHub

Repositorio conectado:

```text
https://github.com/yankyfilms-alt/yf-sessions-records
```

### 2. Crear servicio en Render

Abre:

```text
https://dashboard.render.com/blueprint/new?repo=https://github.com/yankyfilms-alt/yf-sessions-records
```

Render detectara `render.yaml` y creara el servicio `yf-sessions-records`.

### 3. Variables secretas

Render pedira estos valores:

- `ADMIN_PASSWORD`: contrasena privada del dashboard.
- `ADMIN_PASSWORD_SALT`: texto largo aleatorio para cifrar la contrasena.

Ejemplo de salt:

```text
yf-sessions-records-2026-cambia-esto-por-un-texto-largo
```

### 4. URL temporal

Cuando Render termine, la web quedara en una URL parecida a:

```text
https://yf-sessions-records.onrender.com
```

El dashboard privado:

```text
https://yf-sessions-records.onrender.com/yf-sessions-web.html#admin
```

### 5. Dominio final

Dominio principal:

```text
https://yfstudiopro.online
```

Dominio con www:

```text
https://www.yfstudiopro.online
```

En Render, entra al servicio `yf-sessions-records`, abre `Settings` -> `Custom Domains` y agrega:

```text
yfstudiopro.online
www.yfstudiopro.online
```

Despues Render mostrara los registros DNS exactos que hay que poner en el proveedor del dominio.

### Nota importante

El plan gratis de Render puede dormir cuando no hay visitas. Para datos persistentes reales a largo plazo conviene usar una base de datos gestionada o un disco persistente de pago.
