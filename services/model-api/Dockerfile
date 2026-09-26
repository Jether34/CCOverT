FROM python:3.12-slim
WORKDIR /service
COPY services/model-api/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY services/model-api/ccover_model ./ccover_model
ENV PYTHONUNBUFFERED=1
USER 10001:10001
EXPOSE 8000
CMD ["uvicorn", "ccover_model.api:app", "--host", "0.0.0.0", "--port", "8000"]
