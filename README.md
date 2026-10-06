# 💸 Mis Gastos

App web para registrar mis gastos personales en **ARS y USD** (con la cotización del dólar que pagué en cada gasto).
Está alojada en **GitHub Pages** y usa **Supabase** como base de datos. Las dos cosas son gratis.

## Funciones
- Cargar, editar y borrar gastos (fecha, descripción, categoría, medio de pago, moneda, monto, nota)
- Gastos en USD con la **cotización pagada**, y botones que traen el dólar de hoy (Oficial / Tarjeta / MEP / Blue)
- Resumen del mes: total en pesos, total en USD, cantidad de gastos, categoría principal y comparación con el mes anterior
- Gráfico por categoría y gráfico de los últimos 12 meses
- Filtros por mes, categoría, moneda y texto
- Exportar a CSV (se abre bien en Excel)
- Login con email y contraseña: solo vos ves tus datos

---

## 1. Configurar Supabase (una sola vez, ~10 min)

1. Creá una cuenta en <https://supabase.com> y armá un **New project** (plan Free). Elegí la región **São Paulo** para que ande más rápido.
2. Andá a **SQL Editor → New query**, pegá el contenido de [`supabase.sql`](supabase.sql) y tocá **Run**.
3. Creá tu usuario: **Authentication → Users → Add user → Create new user**
   (poné tu email y una contraseña, y marcá *Auto Confirm User*).
4. **Cerrá el registro** para que nadie más pueda crearse una cuenta:
   **Authentication → Sign In / Providers →** desactivá **Allow new users to sign up**.
5. Copiá tus datos de conexión en **Project Settings → API** (o **Data API / API Keys**):
   - **Project URL**
   - **anon / publishable key**
6. Pegalos en [`config.js`](config.js):
   ```js
   window.APP_CONFIG = {
     SUPABASE_URL: "https://xxxx.supabase.co",
     SUPABASE_ANON_KEY: "eyJ...",
   };
   ```

> ℹ️ La clave *anon* es pública por diseño, así que puede quedar en GitHub sin problema.
> Los datos están protegidos por el login y por las reglas de seguridad (RLS) de `supabase.sql`.
> **Nunca** pongas la clave `service_role` / `secret`.

## 2. Publicar en GitHub Pages

1. Creá un repositorio en GitHub (por ejemplo `mis-gastos`) y subí estos archivos.
2. En el repo: **Settings → Pages → Source: Deploy from a branch → `main` / `(root)` → Save**.
3. En 1–2 minutos queda online en `https://TU-USUARIO.github.io/mis-gastos/`.

Cada vez que hagas un cambio y lo subas (push), la página se actualiza sola.

## Probar en tu compu

Abrí `index.html` con doble clic. Si `config.js` está vacío, la app entra en **modo demo**
y guarda los gastos solo en ese navegador.

## Sobre el plan gratis de Supabase
- 500 MB de base de datos: alcanza para **millones** de gastos.
- ⚠️ Si el proyecto pasa **1 semana sin uso**, Supabase lo pausa. Los datos **no se pierden**:
  entrás al panel de Supabase y lo reactivás con un clic. Si cargás gastos seguido, no pasa.

## Personalizar
En [`app.js`](app.js), al principio del archivo:
- `CATEGORIAS`: nombres, íconos y colores
- `MEDIOS_PAGO`: lista de medios de pago

Si agregás una categoría nueva, también tenés que sumarla en el `check (categoria in (...))` de la tabla en Supabase.
