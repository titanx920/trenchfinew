import mongoose from 'mongoose';

// One versioned document holds the whole Sweep Desk shared state, stored as a
// JSON string so arbitrary keys (account numbers, spreadsheet column names)
// never collide with MongoDB field-name rules.
const SweepStateSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, default: 'main' },
    version: { type: Number, default: 0 },
    state: { type: String, default: '{}' },
  },
  { timestamps: true }
);

export default mongoose.models.SweepState ||
  mongoose.model('SweepState', SweepStateSchema);
