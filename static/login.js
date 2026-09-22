const form = document.querySelector("#loginForm");
const error = document.querySelector("#loginError");
const button = document.querySelector("#loginButton");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  error.classList.add("hidden");
  button.disabled = true;
  try {
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: document.querySelector("#password").value }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || "Could not sign in");
    }
    window.location.replace("/");
  } catch (requestError) {
    error.textContent = requestError.message;
    error.classList.remove("hidden");
    button.disabled = false;
  }
});
