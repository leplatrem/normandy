# Generated by Django 2.2.5 on 2019-10-08 19:30

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [("recipes", "0016_auto_20190904_2134")]

    operations = [
        migrations.AlterField(
            model_name="reciperevision",
            name="experimenter_slug",
            field=models.CharField(blank=True, max_length=255, null=True),
        )
    ]
