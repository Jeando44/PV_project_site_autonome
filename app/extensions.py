"""
Extensions Flask centralisées
"""
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_wtf.csrf import CSRFProtect
from flask_cors import CORS
from flask_mail import Mail

# Initialisation des extensions (configurées dans create_app)
db = SQLAlchemy()
migrate = Migrate()
csrf = CSRFProtect()
cors = CORS()
mail = Mail()
