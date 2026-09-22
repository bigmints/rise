if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {
      // Rise remains fully usable online when service workers are unavailable.
    });
  });
}
