-- =====================================================================
--  Mis Gastos - esquema de base de datos
--  Pegá todo esto en Supabase > SQL Editor > New query > Run
-- =====================================================================

create table if not exists public.gastos (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  fecha       date not null default current_date,
  descripcion text not null,
  categoria   text not null check (categoria in (
                'comida', 'transporte', 'servicios', 'salidas',
                'tarjeta_credito', 'credito_mp'
              )),
  medio_pago  text,
  moneda      text not null default 'ARS' check (moneda in ('ARS', 'USD')),
  monto       numeric(14, 2) not null check (monto > 0),
  -- Pesos pagados por cada dólar. Obligatoria si moneda = USD, vacía si ARS.
  cotizacion  numeric(14, 2),
  nota        text,
  created_at  timestamptz not null default now(),

  constraint cotizacion_segun_moneda check (
    (moneda = 'USD' and cotizacion is not null and cotizacion > 0)
    or (moneda = 'ARS' and cotizacion is null)
  )
);

create index if not exists gastos_user_fecha_idx on public.gastos (user_id, fecha desc);

-- ---------------------------------------------------------------------
--  Seguridad: cada usuario solo puede ver / tocar SUS gastos
-- ---------------------------------------------------------------------
alter table public.gastos enable row level security;

drop policy if exists "ver mis gastos"     on public.gastos;
drop policy if exists "crear mis gastos"   on public.gastos;
drop policy if exists "editar mis gastos"  on public.gastos;
drop policy if exists "borrar mis gastos"  on public.gastos;

create policy "ver mis gastos" on public.gastos
  for select to authenticated using (auth.uid() = user_id);

create policy "crear mis gastos" on public.gastos
  for insert to authenticated with check (auth.uid() = user_id);

create policy "editar mis gastos" on public.gastos
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "borrar mis gastos" on public.gastos
  for delete to authenticated using (auth.uid() = user_id);
