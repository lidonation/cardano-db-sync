{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TypeFamilies #-}

module Cardano.Db.Schema.Core.GovernanceAndVoting where

import Data.ByteString.Char8 (ByteString)
import Data.Functor.Contravariant
import Data.Int (Int64)
import Data.Text (Text)
import Data.Word (Word16, Word64)
import GHC.Generics (Generic)
import Hasql.Decoders as D
import Hasql.Encoders as E

import qualified Cardano.Db.Schema.Ids as Id
import Cardano.Db.Statement.Function.Core (bulkEncoder)
import Cardano.Db.Statement.Types (DbInfo (..), Entity (..), Key)
import Cardano.Db.Types (
  AnchorType,
  DbLovelace,
  DbWord64,
  GovActionType,
  Vote,
  VoteUrl,
  VoterRole,
  anchorTypeEncoder,
  dbLovelaceBulkEncoder,
  dbLovelaceEncoder,
  govActionTypeEncoder,
  maybeDbLovelaceDecoder,
  maybeDbLovelaceEncoder,
  maybeDbWord64Decoder,
  maybeDbWord64Encoder,
  voteEncoder,
  voteUrlEncoder,
  voterRoleEncoder,
 )
import Contravariant.Extras (contrazip3, contrazip4)

-----------------------------------------------------------------------------------------------------------------------------------
-- GOVERNANCE AND VOTING
-- These tables manage governance-related data, including DReps, committees, and voting procedures.
-----------------------------------------------------------------------------------------------------------------------------------

-- |
-- Table Name: drep_hash
-- Description: Stores hashes of DRep (Decentralized Reputation) records, which are used in governance processes.
-- Schema reference for @drep_hash@:
-- A table for every unique drep key hash. The existance of an entry doesn't mean the DRep is
-- registered. New in 13.2-Conway.
data DrepHash = DrepHash
  { drepHashRaw :: !(Maybe ByteString) -- sqltype=hash28type

  -- ^ The raw bytes of the DRep.
  , drepHashView :: !Text
  -- ^ The human readable encoding of the Drep.
  , drepHashHasScript :: !Bool
  -- ^ Flag which shows if this DRep credentials are a script hash
  }
  deriving (Eq, Show, Generic)

type instance Key DrepHash = Id.DrepHashId
instance DbInfo DrepHash where
  uniqueFields _ = ["raw", "has_script"]

drepHashEncoder :: E.Params DrepHash
drepHashEncoder =
  mconcat
    [ drepHashRaw >$< E.param (E.nullable E.bytea)
    , drepHashView >$< E.param (E.nonNullable E.text)
    , drepHashHasScript >$< E.param (E.nonNullable E.bool)
    ]

-- |
-- Table Name: drep_registration
-- Description: Contains details about the registration of DReps, including their public keys and other identifying information.
-- Schema reference for @drep_registration@:
-- A table for DRep registrations, deregistrations or updates. Registration have positive deposit
-- values, deregistrations have negative and updates have null. Based on this distinction, for a
-- specific DRep, getting the latest entry gives its registration state. New in 13.2-Conway.
data DrepRegistration = DrepRegistration
  { drepRegistrationTxId :: !Id.TxId -- noreference

  -- ^ The Tx table index of the tx that includes this certificate.
  , drepRegistrationCertIndex :: !Word16
  -- ^ The index of this registration within the certificates of this transaction.
  , drepRegistrationDeposit :: !(Maybe Int64)
  -- ^ The deposits payed if this is an initial registration.
  , drepRegistrationDrepHashId :: !Id.DrepHashId -- noreference

  -- ^ The Drep hash index of this registration.
  , drepRegistrationVotingAnchorId :: !(Maybe Id.VotingAnchorId) -- noreference
  }
  deriving (Eq, Show, Generic)

type instance Key DrepRegistration = Id.DrepRegistrationId
instance DbInfo DrepRegistration

drepRegistrationEncoder :: E.Params DrepRegistration
drepRegistrationEncoder =
  mconcat
    [ drepRegistrationTxId >$< Id.idEncoder Id.getTxId
    , drepRegistrationCertIndex >$< E.param (E.nonNullable $ fromIntegral >$< E.int2)
    , drepRegistrationDeposit >$< E.param (E.nullable E.int8)
    , drepRegistrationDrepHashId >$< Id.idEncoder Id.getDrepHashId
    , drepRegistrationVotingAnchorId >$< Id.maybeIdEncoder Id.getVotingAnchorId
    ]

-- |
-- Table Name: drep_distr
-- Description: Contains information about the distribution of DRep tokens, including the amount distributed and the epoch in which the distribution occurred.
-- Schema reference for @drep_distr@:
-- The distribution of delegated voting power per DRep and epoch. Entries are aggregate amounts,
-- not individual delegations. New in 13.2-Conway.
data DrepDistr = DrepDistr
  { drepDistrHashId :: !Id.DrepHashId -- noreference

  -- ^ The DrepHash table index that this distribution entry has information about.
  , drepDistrAmount :: !Word64
  -- ^ The total amount of voting power this DRep is delegated.
  , drepDistrEpochNo :: !Word64 -- sqltype=word31type

  -- ^ The epoch no this distribution is about.
  , drepDistrActiveUntil :: !(Maybe Word64) -- sqltype=word31type

  -- ^ The epoch until which this drep is active.
  }
  deriving (Eq, Show, Generic)

type instance Key DrepDistr = Id.DrepDistrId
instance DbInfo DrepDistr where
  unnestParamTypes _ =
    [ ("hash_id", "bigint[]")
    , ("amount", "bigint[]")
    , ("epoch_no", "bigint[]")
    , ("active_until", "bigint[]")
    ]

drepDistrBulkEncoder :: E.Params ([Id.DrepHashId], [Word64], [Word64], [Maybe Word64])
drepDistrBulkEncoder =
  contrazip4
    (bulkEncoder $ E.nonNullable $ Id.getDrepHashId >$< E.int8)
    (bulkEncoder $ E.nonNullable $ fromIntegral >$< E.int8)
    (bulkEncoder $ E.nonNullable $ fromIntegral >$< E.int8)
    (bulkEncoder $ E.nullable $ fromIntegral >$< E.int8)

-- |
-- Table Name: delegation_vote
-- Description: Tracks votes cast by stakeholders to delegate their voting rights to other entities within the governance framework.
-- Schema reference for @delegation_vote@:
-- A table containing delegations from a stake address to a drep. New in 13.2-Conway.
data DelegationVote = DelegationVote
  { delegationVoteAddrId :: !Id.StakeAddressId -- noreference

  -- ^ The StakeAddress table index for the stake address.
  , delegationVoteCertIndex :: !Word16
  -- ^ The index of this delegation within the certificates of this transaction.
  , delegationVoteDrepHashId :: !Id.DrepHashId -- noreference

  -- ^ The DrepHash table index for the drep being delegated to.
  , delegationVoteTxId :: !Id.TxId -- noreference

  -- ^ The Tx table index of the transaction that contained this delegation.
  , delegationVoteRedeemerId :: !(Maybe Id.RedeemerId) -- noreference

  -- ^ The Redeemer table index that is related with this certificate. TODO: can vote redeemers index
  -- these delegations?
  }
  deriving (Eq, Show, Generic)

type instance Key DelegationVote = Id.DelegationVoteId
instance DbInfo DelegationVote

delegationVoteEncoder :: E.Params DelegationVote
delegationVoteEncoder =
  mconcat
    [ delegationVoteAddrId >$< Id.idEncoder Id.getStakeAddressId
    , delegationVoteCertIndex >$< E.param (E.nonNullable $ fromIntegral >$< E.int2)
    , delegationVoteDrepHashId >$< Id.idEncoder Id.getDrepHashId
    , delegationVoteTxId >$< Id.idEncoder Id.getTxId
    , delegationVoteRedeemerId >$< Id.maybeIdEncoder Id.getRedeemerId
    ]

-- |
-- Table Name: gov_action_proposal
-- Description: Contains proposals for governance actions, including the type of action, the amount of the deposit, and the expiration date.
-- Schema reference for @gov_action_proposal@:
-- A table for proposed GovActionProposal, aka ProposalProcedure, GovAction or GovProposal. This table
-- may be referenced by TreasuryWithdrawal or NewCommittee. New in 13.2-Conway.
data GovActionProposal = GovActionProposal
  { govActionProposalTxId :: !Id.TxId -- noreference

  -- ^ The Tx table index of the tx that includes this certificate.
  , govActionProposalIndex :: !Word64
  -- ^ The index of this proposal procedure within its transaction.
  , govActionProposalPrevGovActionProposal :: !(Maybe Id.GovActionProposalId) -- noreference

  -- ^ The previous related governance action proposal, if any.
  , govActionProposalDeposit :: !DbLovelace -- sqltype=lovelace

  -- ^ The deposit amount payed for this proposal.
  , govActionProposalReturnAddress :: !Id.StakeAddressId -- noreference

  -- ^ The StakeAddress index of the reward address to receive the deposit when it is repaid.
  , govActionProposalExpiration :: !(Maybe Word64) -- sqltype=word31type

  -- ^ Shows the epoch at which this governance action will expire.
  , govActionProposalVotingAnchorId :: !(Maybe Id.VotingAnchorId) -- noreference

  -- ^ The VotingAnchor table index related to this proposal.
  , govActionProposalType :: !GovActionType -- sqltype=govactiontype

  -- ^ Can be one of ParameterChange, HardForkInitiation, TreasuryWithdrawals, NoConfidence,
  -- NewCommittee, NewConstitution, InfoAction
  , govActionProposalDescription :: !Text -- sqltype=jsonb

  -- ^ A Text describing the content of this GovActionProposal in a readable way.
  , govActionProposalParamProposal :: !(Maybe Id.ParamProposalId) -- noreference

  -- ^ If this is a param proposal action, this has the index of the param_proposal table.
  , govActionProposalRatifiedEpoch :: !(Maybe Word64) -- sqltype=word31type

  -- ^ If not null, then this proposal has been ratified at the specfied epoch.
  , govActionProposalEnactedEpoch :: !(Maybe Word64) -- sqltype=word31type

  -- ^ If not null, then this proposal has been enacted at the specfied epoch.
  , govActionProposalDroppedEpoch :: !(Maybe Word64) -- sqltype=word31type

  -- ^ If not null, then this proposal has been dropped at the specfied epoch. A proposal is dropped
  -- when it's expired or enacted or when one of its dependencies is expired.
  , govActionProposalExpiredEpoch :: !(Maybe Word64) -- sqltype=word31type

  -- ^ If not null, then this proposal has been expired at the specfied epoch.
  }
  deriving (Eq, Show, Generic)

type instance Key GovActionProposal = Id.GovActionProposalId

instance DbInfo GovActionProposal where
  jsonbFields _ = ["description"]
  enumFields _ = [("type", "govactiontype")]

govActionProposalEncoder :: E.Params GovActionProposal
govActionProposalEncoder =
  mconcat
    [ govActionProposalTxId >$< Id.idEncoder Id.getTxId
    , govActionProposalIndex >$< E.param (E.nonNullable $ fromIntegral >$< E.int8)
    , govActionProposalPrevGovActionProposal >$< Id.maybeIdEncoder Id.getGovActionProposalId
    , govActionProposalDeposit >$< dbLovelaceEncoder
    , govActionProposalReturnAddress >$< Id.idEncoder Id.getStakeAddressId
    , govActionProposalExpiration >$< E.param (E.nullable $ fromIntegral >$< E.int8)
    , govActionProposalVotingAnchorId >$< Id.maybeIdEncoder Id.getVotingAnchorId
    , govActionProposalType >$< E.param (E.nonNullable govActionTypeEncoder)
    , govActionProposalDescription >$< E.param (E.nonNullable E.text)
    , govActionProposalParamProposal >$< Id.maybeIdEncoder Id.getParamProposalId
    , govActionProposalRatifiedEpoch >$< E.param (E.nullable $ fromIntegral >$< E.int8)
    , govActionProposalEnactedEpoch >$< E.param (E.nullable $ fromIntegral >$< E.int8)
    , govActionProposalDroppedEpoch >$< E.param (E.nullable $ fromIntegral >$< E.int8)
    , govActionProposalExpiredEpoch >$< E.param (E.nullable $ fromIntegral >$< E.int8)
    ]

-- |
-- Table Name: voting_procedure
-- Description: Defines the procedures and rules governing the voting process, including quorum requirements and tallying mechanisms.
-- Schema reference for @voting_procedure@:
-- A table for voting procedures, aka GovVote. A Vote can be Yes No or Abstain. New in 13.2-Conway.
data VotingProcedure = VotingProcedure
  { votingProcedureTxId :: !Id.TxId -- noreference

  -- ^ The Tx table index of the tx that includes this VotingProcedure.
  , votingProcedureIndex :: !Word16
  -- ^ The index of this VotingProcedure within this transaction.
  , votingProcedureGovActionProposalId :: !Id.GovActionProposalId -- noreference

  -- ^ The index of the GovActionProposal that this vote targets.
  , votingProcedureVoterRole :: !VoterRole -- sqltype=voterrole

  -- ^ The role of the voter. Can be one of ConstitutionalCommittee, DRep, SPO.
  , votingProcedureDrepVoter :: !(Maybe Id.DrepHashId) -- noreference

  -- ^ A reference to the drep hash entry that voted
  , votingProcedurePoolVoter :: !(Maybe Id.PoolHashId) -- noreference

  -- ^ A reference to the pool hash entry that voted
  , votingProcedureVote :: !Vote -- sqltype=vote

  -- ^ The Vote. Can be one of Yes, No, Abstain.
  , votingProcedureVotingAnchorId :: !(Maybe Id.VotingAnchorId) -- noreference

  -- ^ The VotingAnchor table index associated with this VotingProcedure.
  , votingProcedureCommitteeVoter :: !(Maybe Id.CommitteeHashId) -- noreference

  -- ^ A reference to the hot key committee hash entry that voted
  , votingProcedureInvalid :: !(Maybe Id.EventInfoId) -- noreference

  -- ^ TODO: This is currently not implemented and always stays null. Not null if the vote is invalid.
  }
  deriving (Eq, Show, Generic)

type instance Key VotingProcedure = Id.VotingProcedureId

instance DbInfo VotingProcedure where
  enumFields _ = [("voter_role", "voterrole"), ("vote", "vote")]

votingProcedureEncoder :: E.Params VotingProcedure
votingProcedureEncoder =
  mconcat
    [ votingProcedureTxId >$< Id.idEncoder Id.getTxId
    , votingProcedureIndex >$< E.param (E.nonNullable $ fromIntegral >$< E.int2)
    , votingProcedureGovActionProposalId >$< Id.idEncoder Id.getGovActionProposalId
    , votingProcedureVoterRole >$< E.param (E.nonNullable voterRoleEncoder)
    , votingProcedureDrepVoter >$< Id.maybeIdEncoder Id.getDrepHashId
    , votingProcedurePoolVoter >$< Id.maybeIdEncoder Id.getPoolHashId
    , votingProcedureVote >$< E.param (E.nonNullable voteEncoder)
    , votingProcedureVotingAnchorId >$< Id.maybeIdEncoder Id.getVotingAnchorId
    , votingProcedureCommitteeVoter >$< Id.maybeIdEncoder Id.getCommitteeHashId
    , votingProcedureInvalid >$< Id.maybeIdEncoder Id.getEventInfoId
    ]

-- |
-- Table Name: voting_anchor
-- Description: Acts as an anchor point for votes, ensuring they are securely recorded and linked to specific proposals.
-- Schema reference for @voting_anchor@:
-- A table for every Anchor that appears on Governance Actions. These are pointers to offchain
-- metadata. The tuple of url and hash is unique. New in 13.2-Conway.
data VotingAnchor = VotingAnchor
  { votingAnchorUrl :: !VoteUrl -- sqltype=varchar

  -- ^ A URL to a JSON payload of metadata
  , votingAnchorDataHash :: !ByteString
  -- ^ A hash of the contents of the metadata URL
  , votingAnchorType :: !AnchorType -- sqltype=anchorType

  -- ^ The type of the anchor. It can be gov_action, drep, other, vote, committee_dereg, constitution
  , votingAnchorBlockId :: !Id.BlockId -- noreference

  -- ^ The Block table index of the tx that includes this anchor. This only exists to facilitate
  -- rollbacks
  }
  deriving (Eq, Show, Generic)

type instance Key VotingAnchor = Id.VotingAnchorId

instance DbInfo VotingAnchor where
  uniqueFields _ = ["data_hash", "url", "type"]
  enumFields _ = [("type", "anchorType")]

votingAnchorEncoder :: E.Params VotingAnchor
votingAnchorEncoder =
  mconcat
    [ votingAnchorUrl >$< E.param (E.nonNullable voteUrlEncoder)
    , votingAnchorDataHash >$< E.param (E.nonNullable E.bytea)
    , votingAnchorType >$< E.param (E.nonNullable anchorTypeEncoder)
    , votingAnchorBlockId >$< Id.idEncoder Id.getBlockId
    ]

-- |
-- Table Name: constitution
-- Description: Holds the on-chain constitution, which defines the rules and principles of the blockchain's governance system.
-- Schema reference for @constitution@:
-- A table for constitution attached to a GovActionProposal. New in 13.2-Conway.
data Constitution = Constitution
  { constitutionGovActionProposalId :: !(Maybe Id.GovActionProposalId) -- noreference

  -- ^ The GovActionProposal table index for this constitution.
  , constitutionVotingAnchorId :: !Id.VotingAnchorId -- noreference

  -- ^ The VotingAnchor table index for this constitution.
  , constitutionScriptHash :: !(Maybe ByteString) -- sqltype=hash28type

  -- ^ The Script Hash. It's associated script may not be already inserted in the script table.
  }
  deriving (Eq, Show, Generic)

type instance Key Constitution = Id.ConstitutionId
instance DbInfo Constitution

constitutionEncoder :: E.Params Constitution
constitutionEncoder =
  mconcat
    [ constitutionGovActionProposalId >$< Id.maybeIdEncoder Id.getGovActionProposalId
    , constitutionVotingAnchorId >$< Id.idEncoder Id.getVotingAnchorId
    , constitutionScriptHash >$< E.param (E.nullable E.bytea)
    ]

-- |
-- Table Name: committee
-- Description: Contains information about the committee, including the quorum requirements and the proposal being considered.
-- Schema reference for @committee@:
-- A table for new committee proposed on a GovActionProposal. New in 13.2-Conway.
data Committee = Committee
  { committeeGovActionProposalId :: !(Maybe Id.GovActionProposalId) -- noreference

  -- ^ The GovActionProposal table index for this new committee. This can be null for genesis
  -- committees.
  , committeeQuorumNumerator :: !Word64
  -- ^ The proposed quorum numerator.
  , committeeQuorumDenominator :: !Word64
  -- ^ The proposed quorum denominator.
  }
  deriving (Eq, Show, Generic)

type instance Key Committee = Id.CommitteeId
instance DbInfo Committee

committeeDecoder :: D.Row Committee
committeeDecoder =
  Committee
    <$> Id.maybeIdDecoder Id.GovActionProposalId -- committeeGovActionProposalId
    <*> D.column (D.nonNullable $ fromIntegral <$> D.int8) -- committeeQuorumNumerator
    <*> D.column (D.nonNullable $ fromIntegral <$> D.int8) -- committeeQuorumDenominator

committeeEncoder :: E.Params Committee
committeeEncoder =
  mconcat
    [ committeeGovActionProposalId >$< Id.maybeIdEncoder Id.getGovActionProposalId
    , committeeQuorumNumerator >$< E.param (E.nonNullable $ fromIntegral >$< E.int8)
    , committeeQuorumDenominator >$< E.param (E.nonNullable $ fromIntegral >$< E.int8)
    ]

-----------------------------------------------------------------------------------------------------------------------------------

-- |
-- Table Name: committee_hash
-- Description: Stores hashes of committee records, which are used in governance processes.
-- Schema reference for @committee_hash@:
-- A table for all committee credentials hot or cold
data CommitteeHash = CommitteeHash
  { committeeHashRaw :: !ByteString -- sqltype=hash28type

  -- ^ The key or script hash
  , committeeHashHasScript :: !Bool
  -- ^ Flag which shows if this credential is a script hash
  }
  deriving (Eq, Show, Generic)

type instance Key CommitteeHash = Id.CommitteeHashId
instance DbInfo CommitteeHash where
  uniqueFields _ = ["raw", "has_script"]

committeeHashEncoder :: E.Params CommitteeHash
committeeHashEncoder =
  mconcat
    [ committeeHashRaw >$< E.param (E.nonNullable E.bytea)
    , committeeHashHasScript >$< E.param (E.nonNullable E.bool)
    ]

-----------------------------------------------------------------------------------------------------------------------------------

-- |
-- Table Name: committeemember
-- Description: Contains information about committee members.
-- Schema reference for @committee_member@:
-- A table for members of the committee. A committee can have multiple members. New in 13.3-Conway.
data CommitteeMember = CommitteeMember
  { committeeMemberCommitteeId :: !Id.CommitteeId -- OnDeleteCascade -- here intentionally we use foreign keys

  -- ^ The reference to the committee
  , committeeMemberCommitteeHashId :: !Id.CommitteeHashId -- noreference

  -- ^ The reference to the committee hash
  , committeeMemberExpirationEpoch :: !Word64 -- sqltype=word31type

  -- ^ The epoch this member expires
  }
  deriving (Eq, Show, Generic)

type instance Key CommitteeMember = Id.CommitteeMemberId
instance DbInfo CommitteeMember

committeeMemberEncoder :: E.Params CommitteeMember
committeeMemberEncoder =
  mconcat
    [ committeeMemberCommitteeId >$< Id.idEncoder Id.getCommitteeId
    , committeeMemberCommitteeHashId >$< Id.idEncoder Id.getCommitteeHashId
    , committeeMemberExpirationEpoch >$< E.param (E.nonNullable $ fromIntegral >$< E.int8)
    ]

-----------------------------------------------------------------------------------------------------------------------------------

-- |
-- Table Name: committeeregistration
-- Description: Contains information about the registration of committee members, including their public keys and other identifying information.
-- Schema reference for @committee_registration@:
-- A table for every committee hot key registration. New in 13.2-Conway.
data CommitteeRegistration = CommitteeRegistration
  { committeeRegistrationTxId :: !Id.TxId -- noreference

  -- ^ The Tx table index of the tx that includes this certificate.
  , committeeRegistrationCertIndex :: !Word16
  -- ^ The index of this registration within the certificates of this transaction.
  , committeeRegistrationColdKeyId :: !Id.CommitteeHashId -- noreference

  -- ^ The reference to the registered cold key hash id
  , committeeRegistrationHotKeyId :: !Id.CommitteeHashId -- noreference

  -- ^ The reference to the registered hot key hash id
  }
  deriving (Eq, Show, Generic)

type instance Key CommitteeRegistration = Id.CommitteeRegistrationId
instance DbInfo CommitteeRegistration

committeeRegistrationEncoder :: E.Params CommitteeRegistration
committeeRegistrationEncoder =
  mconcat
    [ committeeRegistrationTxId >$< Id.idEncoder Id.getTxId
    , committeeRegistrationCertIndex >$< E.param (E.nonNullable $ fromIntegral >$< E.int2)
    , committeeRegistrationColdKeyId >$< Id.idEncoder Id.getCommitteeHashId
    , committeeRegistrationHotKeyId >$< Id.idEncoder Id.getCommitteeHashId
    ]

-----------------------------------------------------------------------------------------------------------------------------------

-- |
-- Table Name: committeede_registration
-- Description: Contains information about the deregistration of committee members, including their public keys and other identifying information.
-- Schema reference for @committee_de_registration@:
-- A table for every committee key de-registration. New in 13.2-Conway.
data CommitteeDeRegistration = CommitteeDeRegistration
  { committeeDeRegistrationTxId :: !Id.TxId -- noreference

  -- ^ The Tx table index of the tx that includes this certificate.
  , committeeDeRegistrationCertIndex :: !Word16
  -- ^ The index of this deregistration within the certificates of this transaction.
  , committeeDeRegistrationVotingAnchorId :: !(Maybe Id.VotingAnchorId) -- noreference

  -- ^ The Voting anchor reference id
  , committeeDeRegistrationColdKeyId :: !Id.CommitteeHashId -- noreference

  -- ^ The reference to the the deregistered cold key hash id
  }
  deriving (Eq, Show, Generic)

type instance Key CommitteeDeRegistration = Id.CommitteeDeRegistrationId
instance DbInfo CommitteeDeRegistration

committeeDeRegistrationEncoder :: E.Params CommitteeDeRegistration
committeeDeRegistrationEncoder =
  mconcat
    [ committeeDeRegistrationTxId >$< Id.idEncoder Id.getTxId
    , committeeDeRegistrationCertIndex >$< E.param (E.nonNullable $ fromIntegral >$< E.int2)
    , committeeDeRegistrationVotingAnchorId >$< Id.maybeIdEncoder Id.getVotingAnchorId
    , committeeDeRegistrationColdKeyId >$< Id.idEncoder Id.getCommitteeHashId
    ]

-- |
-- Table Name: param_proposal
-- Description: Contains proposals for changes to the protocol parameters, including the proposed values and the expiration date.
-- Schema reference for @param_proposal@:
-- A table containing block chain parameter change proposals.
data ParamProposal = ParamProposal
  { paramProposalEpochNo :: !(Maybe Word64) -- sqltype=word31type

  -- ^ The epoch for which this parameter proposal in intended to become active. Changed in 13.2-Conway
  -- to nullable is always null in Conway era.
  , paramProposalKey :: !(Maybe ByteString) -- sqltype=hash28type

  -- ^ The hash of the crypto key used to sign this proposal. Changed in 13.2-Conway to nullable is
  -- always null in Conway era.
  , paramProposalMinFeeA :: !(Maybe DbWord64) -- sqltype=word64type

  -- ^ The 'a' parameter to calculate the minimum transaction fee.
  , paramProposalMinFeeB :: !(Maybe DbWord64) -- sqltype=word64type

  -- ^ The 'b' parameter to calculate the minimum transaction fee.
  , paramProposalMaxBlockSize :: !(Maybe DbWord64) -- sqltype=word64type

  -- ^ The maximum block size (in bytes).
  , paramProposalMaxTxSize :: !(Maybe DbWord64) -- sqltype=word64type

  -- ^ The maximum transaction size (in bytes).
  , paramProposalMaxBhSize :: !(Maybe DbWord64) -- sqltype=word64type

  -- ^ The maximum block header size (in bytes).
  , paramProposalKeyDeposit :: !(Maybe DbLovelace) -- sqltype=lovelace

  -- ^ The amount (in Lovelace) require for a deposit to register a StakeAddress.
  , paramProposalPoolDeposit :: !(Maybe DbLovelace) -- sqltype=lovelace

  -- ^ The amount (in Lovelace) require for a deposit to register a stake pool.
  , paramProposalMaxEpoch :: !(Maybe DbWord64) -- sqltype=word64type

  -- ^ The maximum number of epochs in the future that a pool retirement is allowed to be scheduled
  -- for.
  , paramProposalOptimalPoolCount :: !(Maybe DbWord64) -- sqltype=word64type

  -- ^ The optimal number of stake pools.
  , paramProposalInfluence :: !(Maybe Double)
  -- ^ The influence of the pledge on a stake pool's probability on minting a block.
  , paramProposalMonetaryExpandRate :: !(Maybe Double)
  -- ^ The monetary expansion rate.
  , paramProposalTreasuryGrowthRate :: !(Maybe Double)
  -- ^ The treasury growth rate.
  , paramProposalDecentralisation :: !(Maybe Double)
  -- ^ The decentralisation parameter (1 fully centralised, 0 fully decentralised).
  , paramProposalEntropy :: !(Maybe ByteString) -- sqltype=hash32type

  -- ^ The 32 byte string of extra random-ness to be added into the protocol's entropy pool.
  , paramProposalProtocolMajor :: !(Maybe Word16) -- sqltype=word31type

  -- ^ The protocol major number.
  , paramProposalProtocolMinor :: !(Maybe Word16) -- sqltype=word31type

  -- ^ The protocol minor number.
  , paramProposalMinUtxoValue :: !(Maybe DbLovelace) -- sqltype=lovelace

  -- ^ The minimum value of a UTxO entry.
  , paramProposalMinPoolCost :: !(Maybe DbLovelace) -- sqltype=lovelace

  -- ^ The minimum pool cost.
  , paramProposalCostModelId :: !(Maybe Id.CostModelId) -- noreference

  -- ^ The CostModel table index for the proposal.
  , paramProposalPriceMem :: !(Maybe Double)
  -- ^ The per word cost of script memory usage.
  , paramProposalPriceStep :: !(Maybe Double)
  -- ^ The cost of script execution step usage.
  , paramProposalMaxTxExMem :: !(Maybe DbWord64) -- sqltype=word64type

  -- ^ The maximum number of execution memory allowed to be used in a single transaction.
  , paramProposalMaxTxExSteps :: !(Maybe DbWord64) -- sqltype=word64type

  -- ^ The maximum number of execution steps allowed to be used in a single transaction.
  , paramProposalMaxBlockExMem :: !(Maybe DbWord64) -- sqltype=word64type

  -- ^ The maximum number of execution memory allowed to be used in a single block.
  , paramProposalMaxBlockExSteps :: !(Maybe DbWord64) -- sqltype=word64type

  -- ^ The maximum number of execution steps allowed to be used in a single block.
  , paramProposalMaxValSize :: !(Maybe DbWord64) -- sqltype=word64type

  -- ^ The maximum Val size.
  , paramProposalCollateralPercent :: !(Maybe Word16) -- sqltype=word31type

  -- ^ The percentage of the txfee which must be provided as collateral when including non-native
  -- scripts.
  , paramProposalMaxCollateralInputs :: !(Maybe Word16) -- sqltype=word31type

  -- ^ The maximum number of collateral inputs allowed in a transaction.
  , paramProposalRegisteredTxId :: !Id.TxId -- noreference

  -- ^ The Tx table index for the transaction that contains this parameter proposal.
  , paramProposalCoinsPerUtxoSize :: !(Maybe DbLovelace) -- sqltype=lovelace

  -- ^ For Alonzo this is the cost per UTxO word. For Babbage and later per UTxO byte. New in v13:
  -- Renamed from coins_per_utxo_word.
  , paramProposalPvtMotionNoConfidence :: !(Maybe Double)
  -- ^ Pool Voting threshold for motion of no-confidence. New in 13.2-Conway.
  , paramProposalPvtCommitteeNormal :: !(Maybe Double)
  -- ^ Pool Voting threshold for new committee/threshold (normal state). New in 13.2-Conway.
  , paramProposalPvtCommitteeNoConfidence :: !(Maybe Double)
  -- ^ Pool Voting threshold for new committee/threshold (state of no-confidence). New in 13.2-Conway.
  , paramProposalPvtHardForkInitiation :: !(Maybe Double)
  -- ^ Pool Voting threshold for hard-fork initiation. New in 13.2-Conway.
  , paramProposalPvtppSecurityGroup :: !(Maybe Double)
  , paramProposalDvtMotionNoConfidence :: !(Maybe Double)
  -- ^ DRep Vote threshold for motion of no-confidence. New in 13.2-Conway.
  , paramProposalDvtCommitteeNormal :: !(Maybe Double)
  -- ^ DRep Vote threshold for new committee/threshold (normal state). New in 13.2-Conway.
  , paramProposalDvtCommitteeNoConfidence :: !(Maybe Double)
  -- ^ DRep Vote threshold for new committee/threshold (state of no-confidence). New in 13.2-Conway.
  , paramProposalDvtUpdateToConstitution :: !(Maybe Double)
  -- ^ DRep Vote threshold for update to the Constitution. New in 13.2-Conway.
  , paramProposalDvtHardForkInitiation :: !(Maybe Double)
  -- ^ DRep Vote threshold for hard-fork initiation. New in 13.2-Conway.
  , paramProposalDvtPPNetworkGroup :: !(Maybe Double)
  -- ^ DRep Vote threshold for protocol parameter changes, network group. New in 13.2-Conway.
  , paramProposalDvtPPEconomicGroup :: !(Maybe Double)
  -- ^ DRep Vote threshold for protocol parameter changes, economic group. New in 13.2-Conway.
  , paramProposalDvtPPTechnicalGroup :: !(Maybe Double)
  -- ^ DRep Vote threshold for protocol parameter changes, technical group. New in 13.2-Conway.
  , paramProposalDvtPPGovGroup :: !(Maybe Double)
  -- ^ DRep Vote threshold for protocol parameter changes, governance group. New in 13.2-Conway.
  , paramProposalDvtTreasuryWithdrawal :: !(Maybe Double)
  -- ^ DRep Vote threshold for treasury withdrawal. New in 13.2-Conway.
  , paramProposalCommitteeMinSize :: !(Maybe DbWord64) -- sqltype=word64type

  -- ^ Minimal constitutional committee size. New in 13.2-Conway.
  , paramProposalCommitteeMaxTermLength :: !(Maybe DbWord64) --

  -- ^ Constitutional committee term limits. New in 13.2-Conway.
  , paramProposalGovActionLifetime :: !(Maybe DbWord64) -- sqltype=word64type

  -- ^ Governance action expiration. New in 13.2-Conway.
  , paramProposalGovActionDeposit :: !(Maybe DbWord64) -- sqltype=word64type

  -- ^ Governance action deposit. New in 13.2-Conway.
  , paramProposalDrepDeposit :: !(Maybe DbWord64) -- sqltype=word64type

  -- ^ DRep deposit amount. New in 13.2-Conway.
  , paramProposalDrepActivity :: !(Maybe DbWord64) -- sqltype=word64type

  -- ^ DRep activity period. New in 13.2-Conway.
  , paramProposalMinFeeRefScriptCostPerByte :: !(Maybe Double)
  }
  deriving (Show, Eq, Generic)

type instance Key ParamProposal = Id.ParamProposalId
instance DbInfo ParamProposal

entityParamProposalDecoder :: D.Row (Entity ParamProposal)
entityParamProposalDecoder =
  Entity
    <$> Id.idDecoder Id.ParamProposalId -- entityKey
    <*> paramProposalDecoder -- entityVal

paramProposalDecoder :: D.Row ParamProposal
paramProposalDecoder =
  ParamProposal
    <$> D.column (D.nullable $ fromIntegral <$> D.int8) -- paramProposalEpochNo
    <*> D.column (D.nullable D.bytea) -- paramProposalKey
    <*> maybeDbWord64Decoder -- paramProposalMinFeeA
    <*> maybeDbWord64Decoder -- paramProposalMinFeeB
    <*> maybeDbWord64Decoder -- paramProposalMaxBlockSize
    <*> maybeDbWord64Decoder -- paramProposalMaxTxSize
    <*> maybeDbWord64Decoder -- paramProposalMaxBhSize
    <*> maybeDbLovelaceDecoder -- paramProposalKeyDeposit
    <*> maybeDbLovelaceDecoder -- paramProposalPoolDeposit
    <*> maybeDbWord64Decoder -- paramProposalMaxEpoch
    <*> maybeDbWord64Decoder -- paramProposalOptimalPoolCount
    <*> D.column (D.nullable D.float8) -- paramProposalInfluence
    <*> D.column (D.nullable D.float8) -- paramProposalMonetaryExpandRate
    <*> D.column (D.nullable D.float8) -- paramProposalTreasuryGrowthRate
    <*> D.column (D.nullable D.float8) -- paramProposalDecentralisation
    <*> D.column (D.nullable D.bytea) -- paramProposalEntropy
    <*> D.column (D.nullable $ fromIntegral <$> D.int2) -- paramProposalProtocolMajor
    <*> D.column (D.nullable $ fromIntegral <$> D.int2) -- paramProposalProtocolMinor
    <*> maybeDbLovelaceDecoder -- paramProposalMinUtxoValue
    <*> maybeDbLovelaceDecoder -- paramProposalMinPoolCost
    <*> Id.maybeIdDecoder Id.CostModelId -- paramProposalCostModelId
    <*> D.column (D.nullable D.float8) -- paramProposalPriceMem
    <*> D.column (D.nullable D.float8) -- paramProposalPriceStep
    <*> maybeDbWord64Decoder -- paramProposalMaxTxExMem
    <*> maybeDbWord64Decoder -- paramProposalMaxTxExSteps
    <*> maybeDbWord64Decoder -- paramProposalMaxBlockExMem
    <*> maybeDbWord64Decoder -- paramProposalMaxBlockExSteps
    <*> maybeDbWord64Decoder -- paramProposalMaxValSize
    <*> D.column (D.nullable $ fromIntegral <$> D.int2) -- paramProposalCollateralPercent
    <*> D.column (D.nullable $ fromIntegral <$> D.int2) -- paramProposalMaxCollateralInputs
    <*> Id.idDecoder Id.TxId -- paramProposalRegisteredTxId
    <*> maybeDbLovelaceDecoder -- paramProposalCoinsPerUtxoSize
    <*> D.column (D.nullable D.float8) -- paramProposalPvtMotionNoConfidence
    <*> D.column (D.nullable D.float8) -- paramProposalPvtCommitteeNormal
    <*> D.column (D.nullable D.float8) -- paramProposalPvtCommitteeNoConfidence
    <*> D.column (D.nullable D.float8) -- paramProposalPvtHardForkInitiation
    <*> D.column (D.nullable D.float8) -- paramProposalPvtppSecurityGroup
    <*> D.column (D.nullable D.float8) -- paramProposalDvtMotionNoConfidence
    <*> D.column (D.nullable D.float8) -- paramProposalDvtCommitteeNormal
    <*> D.column (D.nullable D.float8) -- paramProposalDvtCommitteeNoConfidence
    <*> D.column (D.nullable D.float8) -- paramProposalDvtUpdateToConstitution
    <*> D.column (D.nullable D.float8) -- paramProposalDvtHardForkInitiation
    <*> D.column (D.nullable D.float8) -- paramProposalDvtPPNetworkGroup
    <*> D.column (D.nullable D.float8) -- paramProposalDvtPPEconomicGroup
    <*> D.column (D.nullable D.float8) -- paramProposalDvtPPTechnicalGroup
    <*> D.column (D.nullable D.float8) -- paramProposalDvtPPGovGroup
    <*> D.column (D.nullable D.float8) -- paramProposalDvtTreasuryWithdrawal
    <*> maybeDbWord64Decoder -- paramProposalCommitteeMinSize
    <*> maybeDbWord64Decoder -- paramProposalCommitteeMaxTermLength
    <*> maybeDbWord64Decoder -- paramProposalGovActionLifetime
    <*> maybeDbWord64Decoder -- paramProposalGovActionDeposit
    <*> maybeDbWord64Decoder -- paramProposalDrepDeposit
    <*> maybeDbWord64Decoder -- paramProposalDrepActivity
    <*> D.column (D.nullable D.float8) -- paramProposalMinFeeRefScriptCostPerByte

paramProposalEncoder :: E.Params ParamProposal
paramProposalEncoder =
  mconcat
    [ paramProposalEpochNo >$< E.param (E.nullable $ fromIntegral >$< E.int8)
    , paramProposalKey >$< E.param (E.nullable E.bytea)
    , paramProposalMinFeeA >$< maybeDbWord64Encoder
    , paramProposalMinFeeB >$< maybeDbWord64Encoder
    , paramProposalMaxBlockSize >$< maybeDbWord64Encoder
    , paramProposalMaxTxSize >$< maybeDbWord64Encoder
    , paramProposalMaxBhSize >$< maybeDbWord64Encoder
    , paramProposalKeyDeposit >$< maybeDbLovelaceEncoder
    , paramProposalPoolDeposit >$< maybeDbLovelaceEncoder
    , paramProposalMaxEpoch >$< maybeDbWord64Encoder
    , paramProposalOptimalPoolCount >$< maybeDbWord64Encoder
    , paramProposalInfluence >$< E.param (E.nullable E.float8)
    , paramProposalMonetaryExpandRate >$< E.param (E.nullable E.float8)
    , paramProposalTreasuryGrowthRate >$< E.param (E.nullable E.float8)
    , paramProposalDecentralisation >$< E.param (E.nullable E.float8)
    , paramProposalEntropy >$< E.param (E.nullable E.bytea)
    , paramProposalProtocolMajor >$< E.param (E.nullable $ fromIntegral >$< E.int2)
    , paramProposalProtocolMinor >$< E.param (E.nullable $ fromIntegral >$< E.int2)
    , paramProposalMinUtxoValue >$< maybeDbLovelaceEncoder
    , paramProposalMinPoolCost >$< maybeDbLovelaceEncoder
    , paramProposalCostModelId >$< Id.maybeIdEncoder Id.getCostModelId
    , paramProposalPriceMem >$< E.param (E.nullable E.float8)
    , paramProposalPriceStep >$< E.param (E.nullable E.float8)
    , paramProposalMaxTxExMem >$< maybeDbWord64Encoder
    , paramProposalMaxTxExSteps >$< maybeDbWord64Encoder
    , paramProposalMaxBlockExMem >$< maybeDbWord64Encoder
    , paramProposalMaxBlockExSteps >$< maybeDbWord64Encoder
    , paramProposalMaxValSize >$< maybeDbWord64Encoder
    , paramProposalCollateralPercent >$< E.param (E.nullable $ fromIntegral >$< E.int2)
    , paramProposalMaxCollateralInputs >$< E.param (E.nullable $ fromIntegral >$< E.int2)
    , paramProposalRegisteredTxId >$< Id.idEncoder Id.getTxId
    , paramProposalCoinsPerUtxoSize >$< maybeDbLovelaceEncoder
    , paramProposalPvtMotionNoConfidence >$< E.param (E.nullable E.float8)
    , paramProposalPvtCommitteeNormal >$< E.param (E.nullable E.float8)
    , paramProposalPvtCommitteeNoConfidence >$< E.param (E.nullable E.float8)
    , paramProposalPvtHardForkInitiation >$< E.param (E.nullable E.float8)
    , paramProposalPvtppSecurityGroup >$< E.param (E.nullable E.float8)
    , paramProposalDvtMotionNoConfidence >$< E.param (E.nullable E.float8)
    , paramProposalDvtCommitteeNormal >$< E.param (E.nullable E.float8)
    , paramProposalDvtCommitteeNoConfidence >$< E.param (E.nullable E.float8)
    , paramProposalDvtUpdateToConstitution >$< E.param (E.nullable E.float8)
    , paramProposalDvtHardForkInitiation >$< E.param (E.nullable E.float8)
    , paramProposalDvtPPNetworkGroup >$< E.param (E.nullable E.float8)
    , paramProposalDvtPPEconomicGroup >$< E.param (E.nullable E.float8)
    , paramProposalDvtPPTechnicalGroup >$< E.param (E.nullable E.float8)
    , paramProposalDvtPPGovGroup >$< E.param (E.nullable E.float8)
    , paramProposalDvtTreasuryWithdrawal >$< E.param (E.nullable E.float8)
    , paramProposalCommitteeMinSize >$< maybeDbWord64Encoder
    , paramProposalCommitteeMaxTermLength >$< maybeDbWord64Encoder
    , paramProposalGovActionLifetime >$< maybeDbWord64Encoder
    , paramProposalGovActionDeposit >$< maybeDbWord64Encoder
    , paramProposalDrepDeposit >$< maybeDbWord64Encoder
    , paramProposalDrepActivity >$< maybeDbWord64Encoder
    , paramProposalMinFeeRefScriptCostPerByte >$< E.param (E.nullable E.float8)
    ]

-----------------------------------------------------------------------------------------------------------------------------------

-- |
-- Table Name: treasury_withdrawal
-- Description:
-- Schema reference for @treasury_withdrawal@:
-- A table for all treasury withdrawals proposed on a GovActionProposal. New in 13.2-Conway.
data TreasuryWithdrawal = TreasuryWithdrawal
  { treasuryWithdrawalGovActionProposalId :: !Id.GovActionProposalId -- noreference

  -- ^ The GovActionProposal table index for this withdrawal.Multiple TreasuryWithdrawal may reference
  -- the same GovActionProposal.
  , treasuryWithdrawalStakeAddressId :: !Id.StakeAddressId -- noreference

  -- ^ The address that benefits from this withdrawal.
  , treasuryWithdrawalAmount :: !DbLovelace -- sqltype=lovelace

  -- ^ The amount for this withdrawl.
  }
  deriving (Eq, Show, Generic)

type instance Key TreasuryWithdrawal = Id.TreasuryWithdrawalId

instance DbInfo TreasuryWithdrawal where
  unnestParamTypes _ =
    [ ("gov_action_proposal_id", "bigint[]")
    , ("stake_address_id", "bigint[]")
    , ("amount", "bigint[]")
    ]

treasuryWithdrawalBulkEncoder :: E.Params ([Id.GovActionProposalId], [Id.StakeAddressId], [DbLovelace])
treasuryWithdrawalBulkEncoder =
  contrazip3
    (bulkEncoder $ E.nonNullable $ Id.getGovActionProposalId >$< E.int8)
    (bulkEncoder $ E.nonNullable $ Id.getStakeAddressId >$< E.int8)
    (bulkEncoder dbLovelaceBulkEncoder)

-----------------------------------------------------------------------------------------------------------------------------------

-- |
-- Table Name: event_info
-- Description: Contains information about events, including the epoch in which they occurred and the type of event.
-- Schema reference for @event_info@:
data EventInfo = EventInfo
  { eventInfoTxId :: !(Maybe Id.TxId) -- noreference
  , eventInfoEpoch :: !Word64 -- sqltype=word31type
  , eventInfoType :: !Text
  , eventInfoExplanation :: !(Maybe Text)
  }
  deriving (Eq, Show, Generic)

type instance Key EventInfo = Id.EventInfoId
instance DbInfo EventInfo
