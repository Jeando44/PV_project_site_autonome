from flask_wtf import FlaskForm
from wtforms import StringField, TextAreaField
from wtforms.validators import DataRequired, Email, Length

class ContactForm(FlaskForm):
    lastname = StringField('lastname', validators=[DataRequired(), Length(min=2, max=50)])
    firstname = StringField('firstname', validators=[DataRequired(), Length(min=2, max=50)])
    email = StringField('email', validators=[DataRequired(), Email()])
    message = TextAreaField('message', validators=[DataRequired(), Length(min=10)])