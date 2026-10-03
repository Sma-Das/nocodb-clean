// Keep $report available to error boundaries without collecting or sending data.
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.provide('report', (_error: Error) => {})
})
