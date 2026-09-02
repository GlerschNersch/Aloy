"""
QLoRA fine-tune of gemma-4-12b-it on sft_sample.jsonl (16 hand-curated
real examples â€” see export_dataset.py for how/why).

Deliberately conservative given the tiny dataset: low LoRA rank, few
epochs, only language layers trainable (vision/audio frozen since our
data is text-only and shouldn't touch those). This is a style/tone nudge,
not a capability-teaching run â€” do not expect this to fix knowledge gaps.

Recipe adapted from Unsloth's own Gemma4_(E4B)-Text.ipynb (no dedicated
12B notebook exists yet; the API is architecture-general across the
Gemma4 family, only the model_name differs).
"""
import torch
from unsloth import FastModel
from unsloth.chat_templates import get_chat_template, standardize_data_formats, train_on_responses_only
from datasets import load_dataset
from trl import SFTTrainer, SFTConfig

MODEL_PATH = "models/gemma-4-12b-it"
DATA_PATH = "data/sft_sample.jsonl"
OUTPUT_DIR = "aloy_lora"
MAX_SEQ_LENGTH = 2048

model, tokenizer = FastModel.from_pretrained(
    model_name=MODEL_PATH,
    dtype=None,
    max_seq_length=MAX_SEQ_LENGTH,
    load_in_4bit=True,
    full_finetuning=False,
)

model = FastModel.get_peft_model(
    model,
    finetune_vision_layers=False,
    finetune_language_layers=True,
    finetune_attention_modules=True,
    finetune_mlp_modules=True,
    r=8,
    lora_alpha=8,
    lora_dropout=0,
    bias="none",
    random_state=3407,
)

tokenizer = get_chat_template(tokenizer, chat_template="gemma-4")

dataset = load_dataset("json", data_files=DATA_PATH, split="train")
dataset = standardize_data_formats(dataset)


def formatting_prompts_func(examples):
    convos = examples["conversations"]
    texts = [
        tokenizer.apply_chat_template(convo, tokenize=False, add_generation_prompt=False).removeprefix("<bos>")
        for convo in convos
    ]
    return {"text": texts}


dataset = dataset.map(formatting_prompts_func, batched=True)

print(f"Dataset size: {len(dataset)} examples")
print("--- Sample formatted example ---")
print(dataset[0]["text"])
print("---------------------------------")

trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=dataset,
    eval_dataset=None,
    args=SFTConfig(
        dataset_text_field="text",
        per_device_train_batch_size=1,
        gradient_accumulation_steps=4,
        warmup_steps=2,
        num_train_epochs=3,  # ~12 optimizer steps total on 16 examples â€” conservative on purpose
        learning_rate=2e-4,
        logging_steps=1,
        optim="adamw_8bit",
        weight_decay=0.001,
        lr_scheduler_type="linear",
        seed=3407,
        report_to="none",
        output_dir="outputs",
    ),
)

trainer = train_on_responses_only(trainer)

gpu_stats = torch.cuda.get_device_properties(0)
start_gpu_memory = round(torch.cuda.max_memory_reserved() / 1024 / 1024 / 1024, 3)
max_memory = round(gpu_stats.total_memory / 1024 / 1024 / 1024, 3)
print(f"GPU = {gpu_stats.name}. Max memory = {max_memory} GB. {start_gpu_memory} GB reserved before training.")

trainer_stats = trainer.train()

used_memory = round(torch.cuda.max_memory_reserved() / 1024 / 1024 / 1024, 3)
print(f"Training took {trainer_stats.metrics['train_runtime']:.1f}s")
print(f"Peak reserved memory: {used_memory} GB / {max_memory} GB")

model.save_pretrained(OUTPUT_DIR)
tokenizer.save_pretrained(OUTPUT_DIR)
print(f"Saved LoRA adapter to {OUTPUT_DIR}")

print("Exporting merged GGUF (Q8_0)...")
model.save_pretrained_gguf(
    "aloy_finetune_gguf",
    tokenizer,
    quantization_method="Q8_0",
)
print("Done. GGUF at aloy_finetune_gguf/")

