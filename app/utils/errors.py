# eccezioni custom# app/utils/errors.py
# # =========================
# # Definisce eccezioni custom per import, validazione e pianificazione.

class AppError(Exception):
    pass

class ValidationError(AppError):
    pass
