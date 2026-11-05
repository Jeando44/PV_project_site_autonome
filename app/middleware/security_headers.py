"""
En-têtes de sécurité HTTP.

Deux niveaux volontairement distincts :

1. Des en-têtes *appliqués*, choisis pour ne rien casser : ils ne touchent ni aux
   scripts ni aux styles, et ferment des classes d'attaque entières (détournement de
   clic, reniflage de type MIME, injection de <base>, exfiltration via Referer).

2. Une Content-Security-Policy complète envoyée en *Report-Only*. L'application compte
   57 blocs <script> et plus de 800 attributs style= en ligne : une CSP stricte appliquée
   d'emblée casserait l'interface. Le mode Report-Only journalise les violations dans la
   console du navigateur sans rien bloquer, ce qui permet de retirer progressivement les
   'unsafe-inline'/'unsafe-eval' puis de basculer la politique en mode appliqué.
"""
import os

# Origines réellement utilisées par les pages (relevé sur les templates et le JS).
CDN = "https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://code.jquery.com"

CSP_REPORT_ONLY = "; ".join([
    "default-src 'self'",
    # 'unsafe-inline'/'unsafe-eval' restent nécessaires tant que les scripts en ligne
    # n'ont pas été extraits dans des fichiers ou dotés d'un nonce.
    f"script-src 'self' 'unsafe-inline' 'unsafe-eval' {CDN} "
    "https://cdn.tailwindcss.com https://cdn.sheetjs.com https://maps.googleapis.com https://www.gstatic.com "
    "https://www.google.com/recaptcha/",
    f"style-src 'self' 'unsafe-inline' {CDN} https://fonts.googleapis.com",
    f"font-src 'self' data: https://fonts.gstatic.com {CDN}",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https://maps.googleapis.com https://nominatim.openstreetmap.org "
    "https://data.geopf.fr https://geo.api.gouv.fr https://cadastre.data.gouv.fr "
    "https://inspire.cadastre.gouv.fr https://opendata.enedis.fr",
    "worker-src 'self' blob:",
    "frame-src 'self' https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/",
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
])

# Directives appliquées : aucune ne concerne les scripts ou les styles, donc aucun
# risque de casse. frame-ancestors 'self' autorise les iframes internes de l'application
# (pages de géométrie/calepinage) tout en interdisant l'encadrement par un site tiers.
CSP_ENFORCED = "; ".join([
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
])


def register_security_headers(app):
    """Ajoute les en-têtes de sécurité à toutes les réponses."""

    report_only_active = os.getenv('CSP_REPORT_ONLY', 'true').lower() != 'false'

    @app.after_request
    def set_security_headers(response):
        response.headers.setdefault('X-Content-Type-Options', 'nosniff')
        # SAMEORIGIN et non DENY : l'application encadre ses propres pages dans des
        # iframes (modales de géométrie, calepinage).
        response.headers.setdefault('X-Frame-Options', 'SAMEORIGIN')
        response.headers.setdefault('Referrer-Policy', 'strict-origin-when-cross-origin')
        response.headers.setdefault(
            'Permissions-Policy',
            'geolocation=(self), microphone=(), camera=(), payment=()'
        )
        response.headers.setdefault('Content-Security-Policy', CSP_ENFORCED)

        if report_only_active:
            response.headers.setdefault('Content-Security-Policy-Report-Only', CSP_REPORT_ONLY)

        # HSTS uniquement sur une connexion réellement chiffrée : posé en HTTP local, il
        # forcerait le navigateur à basculer en HTTPS sur localhost et rendrait
        # l'application inaccessible pendant toute la durée du max-age.
        from flask import request
        if request.is_secure:
            response.headers.setdefault(
                'Strict-Transport-Security',
                'max-age=31536000; includeSubDomains'
            )

        return response
