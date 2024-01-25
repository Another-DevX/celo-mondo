import { Form, Formik, FormikErrors, useField, useFormikContext } from 'formik';
import { SyntheticEvent, useCallback, useEffect, useMemo } from 'react';
import { IconButton } from 'src/components/buttons/IconButton';
import { MultiTxFormSubmitButton } from 'src/components/buttons/MultiTxFormSubmitButton';
import { ChevronIcon } from 'src/components/icons/Chevron';
import { AmountField } from 'src/components/input/AmountField';
import { RadioField } from 'src/components/input/RadioField';
import { DropdownMenu } from 'src/components/menus/Dropdown';
import { MIN_GROUP_SCORE_FOR_RANDOM, ZERO_ADDRESS } from 'src/config/consts';
import { LockedBalances } from 'src/features/locking/types';
import { useLockedStatus } from 'src/features/locking/useLockedStatus';
import { getStakeTxPlan } from 'src/features/staking/stakePlan';
import {
  GroupToStake,
  StakeActionType,
  StakeActionValues,
  StakeFormValues,
  StakingBalances,
} from 'src/features/staking/types';
import { useStakingBalances } from 'src/features/staking/useStakingBalances';
import { useTransactionPlan, useWriteContractWithReceipt } from 'src/features/transactions/hooks';
import { ConfirmationDetails } from 'src/features/transactions/types';
import { ValidatorGroupLogo } from 'src/features/validators/ValidatorGroupLogo';
import { ValidatorGroup } from 'src/features/validators/types';
import { useValidatorGroups } from 'src/features/validators/useValidatorGroups';
import { cleanGroupName, getGroupStats } from 'src/features/validators/utils';

import ShuffleIcon from 'src/images/icons/shuffle.svg';
import { toWei } from 'src/utils/amount';
import { logger } from 'src/utils/logger';
import { toTitleCase } from 'src/utils/strings';
import { useAccount } from 'wagmi';

const initialValues: StakeFormValues = {
  action: StakeActionType.Stake,
  amount: 0,
  group: ZERO_ADDRESS,
  transferGroup: ZERO_ADDRESS,
};

export function StakeForm({
  defaultGroup,
  defaultAction,
  onConfirmed,
}: {
  defaultGroup?: Address;
  defaultAction?: StakeActionType;
  onConfirmed: (details: ConfirmationDetails) => void;
}) {
  const { address } = useAccount();
  const { groups, addressToGroup } = useValidatorGroups();
  const { lockedBalances } = useLockedStatus(address);
  const { stakeBalances, groupToStake, refetch } = useStakingBalances(address);

  const { getNextTx, txPlanIndex, numTxs, isPlanStarted, onTxSuccess } =
    useTransactionPlan<StakeFormValues>({
      createTxPlan: (v) => getStakeTxPlan(v, groups || [], groupToStake || {}),
      onStepSuccess: () => refetch,
      onPlanSuccess: (v, r) =>
        onConfirmed({
          message: `${v.action} successful`,
          amount: v.amount,
          receipt: r,
          properties: [
            { label: 'Action', value: toTitleCase(v.action) },
            { label: 'Group', value: addressToGroup?.[v.group]?.name || 'Unknown' },
            { label: 'Amount', value: `${v.amount} CELO` },
          ],
        }),
    });

  const { writeContract, isLoading } = useWriteContractWithReceipt('staking', onTxSuccess);
  const isInputDisabled = isLoading || isPlanStarted;

  const onSubmit = (values: StakeFormValues) => writeContract(getNextTx(values));

  const validate = (values: StakeFormValues) => {
    if (!lockedBalances || !stakeBalances || !groupToStake || !addressToGroup) {
      return { amount: 'Form data not ready' };
    }
    if (txPlanIndex > 0) return {};
    return validateForm(values, lockedBalances, stakeBalances, groupToStake, addressToGroup);
  };

  return (
    <Formik<StakeFormValues>
      initialValues={{
        ...initialValues,
        action: defaultAction || initialValues.action,
        group: defaultGroup || initialValues.group,
      }}
      onSubmit={onSubmit}
      validate={validate}
      validateOnChange={false}
      validateOnBlur={false}
    >
      {({ values }) => (
        <Form className="mt-4 flex flex-1 flex-col justify-between">
          {/* Reserve space for group menu */}
          <div className="min-h-[21.5rem] space-y-4">
            <ActionTypeField defaultAction={defaultAction} disabled={isInputDisabled} />
            <GroupField
              fieldName="group"
              label={values.action === StakeActionType.Transfer ? 'From group' : 'Group'}
              addressToGroup={addressToGroup}
              defaultGroup={defaultGroup}
              disabled={isInputDisabled}
            />
            {values.action === StakeActionType.Transfer && (
              <GroupField
                fieldName="transferGroup"
                label={'To group'}
                addressToGroup={addressToGroup}
                defaultGroup={defaultGroup}
                disabled={isInputDisabled}
              />
            )}
            <StakeAmountField
              lockedBalances={lockedBalances}
              stakeBalances={stakeBalances}
              groupToStake={groupToStake}
              disabled={isInputDisabled}
            />
          </div>
          <MultiTxFormSubmitButton
            txIndex={txPlanIndex}
            numTxs={numTxs}
            isLoading={isLoading}
            loadingText={ActionToVerb[values.action]}
            tipText={ActionToTipText[values.action]}
          >
            {`${toTitleCase(values.action)}`}
          </MultiTxFormSubmitButton>
        </Form>
      )}
    </Formik>
  );
}

function ActionTypeField({
  defaultAction,
  disabled,
}: {
  defaultAction?: StakeActionType;
  disabled?: boolean;
}) {
  return (
    <RadioField<StakeActionType>
      name="action"
      values={StakeActionValues}
      defaultValue={defaultAction}
      disabled={disabled}
    />
  );
}

function StakeAmountField({
  lockedBalances,
  stakeBalances,
  groupToStake,
  disabled,
}: {
  lockedBalances?: LockedBalances;
  stakeBalances?: StakingBalances;
  groupToStake?: GroupToStake;
  disabled?: boolean;
}) {
  const { values } = useFormikContext<StakeFormValues>();
  const { action, group } = values;
  const maxAmountWei = useMemo(
    () => getMaxAmount(action, group, lockedBalances, stakeBalances, groupToStake),
    [action, group, lockedBalances, stakeBalances, groupToStake],
  );

  return (
    <AmountField maxValueWei={maxAmountWei} maxDescription="CELO available" disabled={disabled} />
  );
}

function GroupField({
  fieldName,
  label,
  addressToGroup,
  defaultGroup,
  disabled,
}: {
  fieldName: 'group' | 'transferGroup';
  label: string;
  addressToGroup?: Record<Address, ValidatorGroup>;
  defaultGroup?: Address;
  disabled?: boolean;
}) {
  const [field, , helpers] = useField<Address>(fieldName);

  useEffect(() => {
    helpers.setValue(defaultGroup || ZERO_ADDRESS).catch((e) => logger.error(e));
  }, [defaultGroup, helpers]);

  const currentGroup = addressToGroup?.[field.value];

  const sortedGroups = useMemo(() => {
    if (!addressToGroup) return [];
    return Object.values(addressToGroup)
      .map((g) => ({
        ...g,
        score: getGroupStats(g).avgScore,
      }))
      .sort((a, b) => b.score - a.score);
  }, [addressToGroup]);

  const onClickRandom = useCallback(
    (event: SyntheticEvent) => {
      event.preventDefault();
      if (!sortedGroups?.length) return;
      const goodGroups = sortedGroups.filter((g) => g.score >= MIN_GROUP_SCORE_FOR_RANDOM);
      const randomGroup = goodGroups[Math.floor(Math.random() * goodGroups.length)];
      helpers.setValue(randomGroup.address).catch((e) => logger.error(e));
    },
    [sortedGroups, helpers],
  );

  const onClickGroup = (address: Address) => {
    helpers.setValue(address).catch((e) => logger.error(e));
  };

  return (
    <div className="relative space-y-1">
      <label htmlFor="group" className="pl-0.5 text-xs font-medium">
        {label}
      </label>
      <DropdownMenu
        disabled={disabled}
        buttonClasses="w-full btn btn-outline border-taupe-300 px-3 hover:border-taupe-300 hover:bg-taupe-300/50 disabled:input-disabled"
        button={
          <div className="flex w-full items-center justify-between">
            <div className="flex items-center space-x-2">
              <ValidatorGroupLogo address={field.value} size={28} />
              <span className="text-black">
                {currentGroup?.name ? cleanGroupName(currentGroup.name) : 'Select group'}
              </span>
            </div>
            <ChevronIcon direction="s" width={14} height={14} />
          </div>
        }
        menuClasses="py-2 left-0 right-0 -top-[5.5rem] overflow-y-auto max-h-[24.75rem] all:w-auto divide-y divide-gray-200"
        menuHeader={
          <div className="flex items-center justify-between px-4 pb-2 text-sm">
            <span>Group</span>
            <span>Score</span>
          </div>
        }
        menuItems={sortedGroups.map((g) => {
          return (
            <button
              type="button"
              className="flex w-full cursor-pointer items-center justify-between px-4 py-2 hover:bg-taupe-300/50"
              key={g.address}
              onClick={() => onClickGroup(g.address)}
            >
              <div className="flex items-center space-x-2">
                <ValidatorGroupLogo address={g.address} size={20} />
                <span>{cleanGroupName(g.name)}</span>
              </div>
              <span>{`${g.score}%`}</span>
            </button>
          );
        })}
      />
      {/* Placing shuffle button here to avoid button-in-button html error  */}
      <div className="absolute right-10 top-9 flex items-center space-x-4">
        <IconButton
          imgSrc={ShuffleIcon}
          width={14}
          height={10}
          title="Random"
          onClick={onClickRandom}
          className="px-1 py-1"
          disabled={disabled}
        />
      </div>
    </div>
  );
}

function validateForm(
  values: StakeFormValues,
  lockedBalances: LockedBalances,
  stakeBalances: StakingBalances,
  groupToStake: GroupToStake,
  addressToGroup: Record<Address, ValidatorGroup>,
): FormikErrors<StakeFormValues> {
  const { action, amount, group, transferGroup } = values;

  if (!group || group === ZERO_ADDRESS) return { group: 'Validator group required' };

  if (action === StakeActionType.Stake) {
    const groupDetails = addressToGroup[group];
    if (!groupDetails) return { group: 'Group not found' };
    if (groupDetails.votes >= groupDetails.capacity) return { group: 'Group has max votes' };
  }

  if (action === StakeActionType.Transfer) {
    if (!transferGroup || transferGroup === ZERO_ADDRESS)
      return { transferGroup: 'Transfer group required' };
    if (transferGroup === group) return { transferGroup: 'Groups must be different' };
    const groupDetails = addressToGroup[transferGroup];
    if (!groupDetails) return { group: 'Transfer group not found' };
    if (groupDetails.votes >= groupDetails.capacity)
      return { group: 'Transfer group has max votes' };
  }

  // TODO implement toWeiAdjusted() and use it here
  const amountWei = toWei(amount);
  if (!amountWei || amountWei <= 0n) return { amount: 'Invalid amount' };

  const maxAmountWei = getMaxAmount(action, group, lockedBalances, stakeBalances, groupToStake);
  if (amountWei > maxAmountWei) return { amount: 'Amount exceeds max' };

  return {};
}

function getMaxAmount(
  action: StakeActionType,
  groupAddress: Address,
  lockedBalances?: LockedBalances,
  stakeBalances?: StakingBalances,
  groupToStake?: GroupToStake,
) {
  if (action === StakeActionType.Stake) {
    return (lockedBalances?.locked || 0n) - (stakeBalances?.total || 0n);
  } else if (action === StakeActionType.Unstake || action === StakeActionType.Transfer) {
    if (!groupAddress || !groupToStake?.[groupAddress]) return 0n;
    return groupToStake[groupAddress].active + groupToStake[groupAddress].pending;
  } else {
    throw new Error(`Invalid stake action: ${action}`);
  }
}

const ActionToVerb: Partial<Record<StakeActionType, string>> = {
  [StakeActionType.Stake]: 'Staking',
  [StakeActionType.Transfer]: 'Transferring',
  [StakeActionType.Unstake]: 'Unstaking',
};

const ActionToTipText: Partial<Record<StakeActionType, string>> = {
  [StakeActionType.Transfer]: 'Transfers require unstaking and then restaking.',
};