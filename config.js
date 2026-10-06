// =====================================================================
//  Configuración de Supabase
//  Copiá estos dos valores desde: Supabase > Project Settings > API
//  (Project URL y la clave "anon" / "publishable").
//
//  La clave anon ES PÚBLICA por diseño: está bien que quede en GitHub.
//  Tus datos quedan protegidos por el login + las políticas RLS
//  definidas en supabase.sql.
//
//  Si dejás los valores vacíos, la app funciona en "modo demo"
//  guardando todo solo en este navegador (localStorage).
// =====================================================================
window.APP_CONFIG = {
  SUPABASE_URL: "https://vazclylzlpwpipzhbukf.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_dn9h3mh5clMtqukhLCQY-g_zCrKDqYi",
};
